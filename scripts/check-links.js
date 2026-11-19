// Checks that each airline's deep link (and Google Flights) still answers.
// Usage: npm run check-links
//
// A 2xx/3xx means the URL still resolves. Note: many airline sites block
// automated requests (403/429) or render search results with JavaScript, so a
// "blocked" result isn't proof of a broken link and a 200 isn't proof the
// search pre-fills correctly. Open any suspicious link in a browser to confirm.
import { readFileSync } from "node:fs";
import { AIRLINES, googleFlightsUrl, indexAirports, addDays, todayISO } from "../js/lib.js";

const map = indexAirports(JSON.parse(readFileSync(new URL("../airports.json", import.meta.url))));
const date = addDays(todayISO(), 30);
const pax = { adults: 1, children: 0, infants: 0 };

// A route each airline plausibly serves.
const SAMPLE = { aircanada: ["YYZ", "YVR"], british: ["LHR", "JFK"], lufthansa: ["FRA", "JFK"], airfrance: ["CDG", "JFK"], klm: ["AMS", "JFK"],
  turkish: ["IST", "JFK"], emirates: ["DXB", "JFK"], qatar: ["DOH", "JFK"], singapore: ["SIN", "LHR"], cathay: ["HKG", "LHR"] };

const targets = [
  { name: "Google Flights", url: googleFlightsUrl("JFK", "LAX", date, "economy", pax) },
  ...AIRLINES.map((a) => {
    const [o, d] = SAMPLE[a.key] || ["JFK", "LAX"];
    if (!a.serves(map[o], map[d], 4000)) console.warn(`note: sample route ${o}-${d} isn't one ${a.name} is listed as serving`);
    return { name: a.name, url: a.url(o, d, date, pax, "economy") };
  }),
];

let broken = 0, unreachable = 0;
for (const t of targets) {
  let status, note = "", netErr = false;
  try {
    const res = await fetch(t.url, { redirect: "follow", signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (link-check)", Accept: "text/html" } });
    status = res.status;
    if (res.redirected) note = ` → ${new URL(res.url).host}${new URL(res.url).pathname}`;
  } catch (e) { netErr = true; status = e.name === "TimeoutError" ? "timeout" : e.cause?.code || e.message; }
  const verdict = netErr ? "no-reach" : status < 400 ? "ok" : [401, 403, 405, 429].includes(status) ? "blocked?" : "BROKEN?";
  if (verdict === "BROKEN?") broken++;
  if (netErr) unreachable++;
  console.log(`${verdict.padEnd(9)} ${String(status).padEnd(8)} ${t.name}${note}`);
}
if (unreachable === targets.length) {
  console.log("\nCouldn't reach any site — check this machine's internet connection or proxy, then run again.");
  process.exitCode = 2;
} else {
  if (unreachable) console.log(`\n${unreachable} site(s) couldn't be reached (network error or timeout) — retry or open them in a browser.`);
  console.log(broken ? `${broken} link(s) look broken — open them in a browser to confirm.` : "No obviously broken links.");
  process.exitCode = broken ? 1 : 0;
}
