// Generates the static, crawlable SEO pages from the app's own data:
//   routes/<from>-to-<to>/index.html  — "A to B with a stopover" guide for each popular route
//   routes/index.html                  — list of all route guides
//   sitemap.xml                        — every indexable page
// Run after changing airports, hubs, fares or this route list:  npm run build-pages
// The output is committed (the site has no build step on the host).
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../js/airports.js";
import "../js/hubs.js";
import "../js/lib.js";

const SITE = "https://plan-my-trip.pages.dev";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const L = globalThis.PlanMyTrip;
const { airports, hubs } = globalThis.PlanMyTripData;
const map = L.indexAirports(airports);
const TODAY = L.todayISO();

// Popular long-haul trips where travellers look for a stopover. [from, to]
const ROUTES = [
  ["JFK", "BKK"], ["JFK", "SIN"], ["JFK", "HND"], ["JFK", "DEL"], ["JFK", "BOM"], ["JFK", "MNL"], ["JFK", "DPS"],
  ["JFK", "CPT"], ["JFK", "JNB"], ["JFK", "NBO"], ["JFK", "SYD"], ["JFK", "DXB"], ["JFK", "ATH"], ["JFK", "IST"],
  ["LAX", "SYD"], ["LAX", "MEL"], ["LAX", "AKL"], ["LAX", "BKK"], ["LAX", "SIN"], ["LAX", "DPS"], ["LAX", "MNL"],
  ["LAX", "DEL"], ["LAX", "LHR"], ["LAX", "CDG"],
  ["SFO", "SIN"], ["SFO", "DEL"], ["SFO", "BKK"], ["SFO", "SYD"],
  ["ORD", "DEL"], ["ORD", "BKK"], ["ORD", "MNL"], ["MIA", "MAD"], ["MCO", "LHR"], ["IAH", "DXB"], ["SEA", "BKK"],
  ["YYZ", "BOM"], ["YYZ", "DEL"], ["YYZ", "MNL"], ["YYZ", "BKK"], ["YVR", "SYD"], ["YVR", "DEL"], ["YVR", "BKK"],
  ["LHR", "SYD"], ["LHR", "MEL"], ["LHR", "AKL"], ["LHR", "BKK"], ["LHR", "SIN"], ["LHR", "HKG"], ["LHR", "DPS"],
  ["LHR", "CPT"], ["LHR", "LAX"], ["LHR", "SFO"], ["LHR", "MNL"], ["LHR", "HND"], ["LHR", "GRU"], ["LHR", "LIM"],
  ["CDG", "BKK"], ["CDG", "SYD"], ["CDG", "HND"], ["FRA", "SIN"], ["FRA", "SYD"], ["AMS", "DPS"], ["MAD", "LIM"],
  ["SYD", "LHR"], ["MEL", "LHR"], ["AKL", "LHR"], ["SYD", "JFK"], ["SYD", "LAX"], ["BKK", "LHR"], ["SIN", "LHR"],
  ["DEL", "JFK"], ["BOM", "LHR"], ["MNL", "LAX"], ["DXB", "LAX"], ["GRU", "HND"], ["GRU", "LHR"], ["EZE", "MAD"],
  ["JNB", "SYD"], ["CPT", "LHR"], ["DEL", "YYZ"],
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const city = (c) => map[c].city;
const km = (n) => Math.round(n).toLocaleString("en-US");
const mi = (n) => Math.round(n * 0.621371).toLocaleString("en-US");
const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const fly = (a, b) => L.estimateFlightMinutes(map, a, b);
const fare = (a, b) => L.estimateCost(map, a, b, "economy", { adults: 1 });
const slugOf = ([a, b]) => `${slugify(city(a))}-to-${slugify(city(b))}`;
const planUrl = (q) => `/?${new URLSearchParams(q).toString()}`;

function stopovers(from, to) {
  const ends = new Set([L.locationKey(map, from), L.locationKey(map, to)]);
  const seen = new Set(), direct = L.dist(map, from, to);
  // A real stopover splits the trip: each leg covers at least a quarter of the direct distance.
  const splits = (c) => Math.min(L.dist(map, from, c), L.dist(map, c, to)) >= direct * 0.25;
  return L.hubCandidates(hubs, map, from, to, { count: 200, maxDetour: 1.6, skip: (c) => ends.has(L.locationKey(map, c)) || !splits(c) })
    .filter((h) => { const k = L.locationKey(map, h.code); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);
}

const page = ({ title, description, path, body, jsonld }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0f1216" media="(prefers-color-scheme: dark)" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${path}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Plan My Trip" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${SITE}${path}" />
<meta property="og:image" content="${SITE}/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="stylesheet" href="/styles.css" />
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 1)}
</script>
</head>
<body>
<header>
  <p class="site-name"><a href="/">✈ Plan My Trip</a></p>
</header>
<main class="guide">
${body}
</main>
</body>
</html>
`;

const breadcrumbs = (items) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${path}` })),
});
const crumbNav = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([name, path], i) =>
  i === items.length - 1 ? `<li aria-current="page">${esc(name)}</li>` : `<li><a href="${path}">${esc(name)}</a></li>`).join("")}</ol></nav>`;

// ---------------------------------------------------------------------------
const built = [];
for (const r of ROUTES) {
  const [from, to] = r;
  if (!map[from] || !map[to]) throw new Error(`Unknown airport in route ${from}-${to}`);
  const hubsFor = stopovers(from, to);
  if (hubsFor.length < 3) { console.warn(`skip ${from}-${to}: only ${hubsFor.length} stopovers`); continue; }
  built.push({ from, to, slug: slugOf(r), hubs: hubsFor });
}
const slugs = new Set();
for (const b of built) { if (slugs.has(b.slug)) throw new Error(`duplicate slug ${b.slug}`); slugs.add(b.slug); }

if (existsSync(join(ROOT, "routes"))) rmSync(join(ROOT, "routes"), { recursive: true });

for (const b of built) {
  const { from, to, slug } = b;
  const A = city(from), B = city(to), path = `/routes/${slug}/`;
  const direct = L.dist(map, from, to);
  const rows = b.hubs.map((h) => {
    const t1 = fly(from, h.code), t2 = fly(h.code, to);
    return { code: h.code, city: city(h.code), country: L.countryName(map[h.code].country), extra: Math.max(0, Math.round((h.detour - 1) * 100)), t1, t2, fare: fare(from, h.code) + fare(h.code, to) };
  });
  const top = rows.slice(0, 3).map((x) => x.city);
  const title = `${A} to ${B} with a Stopover: Best Stopover Cities`;
  const describe = (cities) => `Best stopover cities from ${A} to ${B}: ${cities.join(", ")}. Extra distance, flying times and fare estimates for each leg.`;
  const description = [3, 2, 1].map((n) => describe(top.slice(0, n))).find((d) => d.length <= 155) || describe(top.slice(0, 1));
  const related = built.filter((o) => o !== b && (o.from === from || o.to === to || o.from === to || o.to === from)).slice(0, 8);
  const crumbs = [["Home", "/"], ["Stopover routes", "/routes/"], [`${A} to ${B}`, path]];
  const best = rows[0];
  const body = `${crumbNav(crumbs)}
<article>
  <h1>${esc(A)} to ${esc(B)} with a stopover</h1>
  <p class="lead">${esc(A)} (${from}) to ${esc(B)} (${to}) is about <strong>${km(direct)} km (${mi(direct)} miles)</strong> — roughly <strong>${L.formatDuration(fly(from, to))}</strong> of flying nonstop. Splitting the journey with a few days in a stopover city breaks up the jet lag, lets you see a second destination, and booking each leg separately can open up low-cost airlines.</p>
  <p class="cta-row"><a class="cta" href="${esc(planUrl({ from, to, adults: 1, stops: "suggest:any" }))}">Plan ${esc(A)} → ${esc(B)} with a stopover</a></p>

  <h2>Best stopover cities between ${esc(A)} and ${esc(B)}</h2>
  <p>Ranked by how little extra distance they add to the direct route. ${esc(best.city)} adds ${best.extra ? `only about ${best.extra}%` : "almost no"} extra distance.</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th scope="col">Stopover</th><th scope="col">Extra distance</th><th scope="col">Flying time</th><th scope="col">Est. fare from*</th><th scope="col"><span class="visually-hidden">Plan</span></th></tr></thead>
    <tbody>
${rows.map((x) => `      <tr><th scope="row">${esc(x.city)} (${x.code})<span class="sub">${esc(x.country)}</span></th><td>${x.extra ? `+${x.extra}%` : "&lt;1%"}</td><td>${L.formatDuration(x.t1)} + ${L.formatDuration(x.t2)}</td><td>${usd(x.fare)}</td><td><a href="${esc(planUrl({ from, to, adults: 1, stops: `${x.code}:` }))}" aria-label="Plan ${esc(A)} to ${esc(B)} via ${esc(x.city)}">Plan via ${esc(x.city)}</a></td></tr>`).join("\n")}
    </tbody>
  </table>
  </div>
  <p class="sub">*Rough one-way economy estimate for both legs, per person, based on distance and the airlines that usually fly each leg. Check Google Flights or the airline for live prices.</p>

  <h2>How to book ${esc(A)} to ${esc(B)} with a stopover</h2>
  <ol>
    <li><strong>Pick your stopover.</strong> ${esc(rows.slice(0, 3).map((x) => x.city).join(", "))} are the most direct choices on this route.</li>
    <li><strong>Choose your dates.</strong> Decide how many nights to spend in the stopover city — 2 to 4 nights is typical.</li>
    <li><strong>Book each leg.</strong> Plan My Trip links every flight to Google Flights and the airlines likely to fly it. Separate tickets are not protected if a delay makes you miss the next flight, so leave a day or more between legs.</li>
  </ol>
  <p>Some airlines also sell multi-city tickets or free stopover programmes through their hub, which keep both flights on one booking — worth comparing with separate tickets.</p>
${related.length ? `
  <h2>Related stopover routes</h2>
  <ul class="link-list">
${related.map((o) => `    <li><a href="/routes/${o.slug}/">${esc(city(o.from))} to ${esc(city(o.to))}</a></li>`).join("\n")}
  </ul>` : ""}
</article>
<footer>Distances are great-circle; flying times assume about 800 km/h plus 30 minutes for take-off and landing. Prices are rough estimates — always confirm before booking.</footer>`;
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Article", headline: title, description, url: `${SITE}${path}`, dateModified: TODAY, image: `${SITE}/og-image.jpg`,
      author: { "@type": "Organization", name: "Plan My Trip", url: `${SITE}/` }, publisher: { "@type": "Organization", name: "Plan My Trip", url: `${SITE}/` } },
    breadcrumbs(crumbs),
  ] };
  const file = join(ROOT, "routes", slug, "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page({ title: `${A} to ${B} Stopover: Best Cities | Plan My Trip`, description, path, body, jsonld }));
}

// Index of all routes, grouped by departure city
{
  const path = "/routes/";
  const crumbs = [["Home", "/"], ["Stopover routes", path]];
  const groups = new Map();
  for (const b of built) { const k = city(b.from); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  const body = `${crumbNav(crumbs)}
<article>
  <h1>Popular long-haul routes with a stopover</h1>
  <p class="lead">Long flights are easier — and often more fun — with a few days in a city on the way. Each guide lists the stopover cities that add the least extra distance, with flying times and estimated fares, and links straight into the planner.</p>
  <p class="cta-row"><a class="cta" href="/">Plan your own multi-stop trip</a></p>
${[...groups].map(([from, list]) => `  <h2>From ${esc(from)}</h2>
  <ul class="link-list">
${list.map((o) => `    <li><a href="/routes/${o.slug}/">${esc(city(o.from))} to ${esc(city(o.to))}</a> <span class="sub">via ${esc(o.hubs.slice(0, 3).map((h) => city(h.code)).join(", "))}</span></li>`).join("\n")}
  </ul>`).join("\n")}
</article>`;
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "CollectionPage", name: "Popular long-haul routes with a stopover", url: `${SITE}${path}` },
    breadcrumbs(crumbs),
  ] };
  mkdirSync(join(ROOT, "routes"), { recursive: true });
  writeFileSync(join(ROOT, "routes", "index.html"), page({
    title: "Stopover Guides for Long-Haul Flights | Plan My Trip",
    description: `Stopover guides for ${built.length} popular long-haul routes — the best cities to break up your journey, with flying times and estimated fares.`,
    path, body, jsonld,
  }));
}

// Sitemap
const urls = ["/", "/routes/", ...built.map((b) => `/routes/${b.slug}/`)];
writeFileSync(join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`);
console.log(`Built ${built.length} route pages, routes index and sitemap (${urls.length} URLs).`);
