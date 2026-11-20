// Pure trip-planning logic: no DOM access, so it can be unit-tested in Node.

// ---------------------------------------------------------------------------
// Dates — all handled as local "YYYY-MM-DD" strings (never via UTC)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoLocal(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const todayISO = (now = new Date()) => isoLocal(now);
export const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Fly-out date for every waypoint that has an outgoing flight.
 * Index 0 = origin (depart), 1..n = stops.
 * Fixed stop dates are kept; the rest are spread evenly between known dates.
 * The last stop flies out on `end` (the final flight) unless it has a fixed date.
 */
export function scheduleDates(depart, end, stopDates) {
  const last = stopDates.length;
  const out = [depart, ...stopDates.map((d) => d || null)];
  if (last > 0 && !out[last]) out[last] = end;
  for (let k = 1; k < last; k++) {
    if (out[k]) continue;
    let i = k - 1; while (!out[i]) i--;
    let j = k + 1; while (!out[j]) j++;
    out[k] = addDays(out[i], Math.round((daysBetween(out[i], out[j]) * (k - i)) / (j - i)));
  }
  return out;
}

/** Returns an error message, or null if the fixed stop dates are consistent. */
export function validateStopDates(depart, end, stopDates, endUsed) {
  let prev = depart, prevLabel = "your departure date";
  for (let i = 0; i < stopDates.length; i++) {
    const d = stopDates[i];
    if (!d) continue;
    if (d < prev) return `Stop ${i + 1}'s date (${d}) is before ${prevLabel} (${prev}).`;
    if (endUsed && end && d > end) return `Stop ${i + 1}'s date (${d}) is after your end date (${end}).`;
    prev = d; prevLabel = `stop ${i + 1}'s date`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Airports
// ---------------------------------------------------------------------------
export function indexAirports(list) {
  const map = {};
  list.forEach((a) => { map[a.iata] = a; });
  return map;
}

/** Best matches first; within equal matches, `preferred` codes (major hubs) come first. */
export function searchAirports(list, query, limit = 8, preferred = new Set()) {
  const q = (query || "").trim().toUpperCase();
  if (!q) return [];
  const scored = [];
  for (const a of list) {
    const city = a.city.toUpperCase(), name = a.name.toUpperCase();
    let s = -1;
    if (a.iata === q) s = 0;
    else if (city === q) s = 1;
    else if (city.startsWith(q)) s = 2;
    else if (a.iata.startsWith(q)) s = 3;
    else if (name.startsWith(q)) s = 4;
    else if (city.includes(q)) s = 5;
    else if (name.includes(q)) s = 6;
    if (s >= 0) scored.push([s, a]);
  }
  const pri = (a) => (preferred.has(a.iata) ? 0 : 1);
  scored.sort((x, y) => x[0] - y[0] || pri(x[1]) - pri(y[1]) || x[1].city.localeCompare(y[1].city));
  return scored.slice(0, limit).map((x) => x[1]);
}

/** Turn what the user typed ("jfk", "London", "Heathrow") into an IATA code, or null. */
export function resolveAirport(map, list, value, preferred) {
  const v = (value || "").trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (/^[A-Z]{3}$/.test(up)) return map[up] ? up : null;
  if (v.length < 3) return null;
  const hit = searchAirports(list, v, 1, preferred)[0];
  return hit ? hit.iata : null;
}

export const airportLabel = (map, code) => { const a = map[code]; return a ? `${a.city} (${a.iata})` : code; };

/** City-level identity of an airport: airports in the same city (LHR, LGW…) share a key. */
export const locationKey = (map, code) => { const a = map[code]; return a ? `${a.city}|${a.country}` : code; };

// ---------------------------------------------------------------------------
// Places to avoid: entries are 3-letter airport codes (avoids that whole city)
// or 2-letter country codes (avoids the whole country).
// ---------------------------------------------------------------------------
let regionNames = null;
try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { regionNames = null; }
export function countryName(code) {
  try { const n = regionNames && regionNames.of(code); if (n && n !== code) return n; } catch { /* unknown code */ }
  return code;
}

/** Countries that have at least one airport, sorted by name: [{ code, name }]. */
export function countryList(airports) {
  return [...new Set(airports.map((a) => a.country))].map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const isCountryEntry = (x) => /^[A-Z]{2}$/.test(x);

/** Returns code => true if that airport is in an avoided city or country. */
export function avoidChecker(map, avoid = []) {
  const countries = new Set(avoid.filter(isCountryEntry));
  const places = new Set(avoid.filter((x) => /^[A-Z]{3}$/.test(x)).map((c) => locationKey(map, c)));
  if (!countries.size && !places.size) return () => false;
  return (code) => { const a = map[code]; return !!a && (countries.has(a.country) || places.has(locationKey(map, code))); };
}

/** Human label for an avoid entry: "Russia (whole country)", "London (all airports)", "Orlando (MCO)". */
export function avoidLabel(map, airports, entry) {
  if (isCountryEntry(entry)) return `${countryName(entry)} (whole country)`;
  const a = map[entry];
  if (!a) return entry;
  const sameCity = airports.filter((b) => b.city === a.city && b.country === a.country).length;
  return sameCity > 1 ? `${a.city}, ${a.country} (all airports)` : `${a.city}, ${a.country} (${a.iata})`;
}

/** Autocomplete for the avoid box: matching countries first, then airports. Items: { value, code, detail }. */
export function searchPlaces(countries, airports, query, limit = 8, preferred = new Set()) {
  const q = (query || "").trim().toUpperCase();
  if (!q) return [];
  const cs = countries
    .filter((c) => c.code === q || c.name.toUpperCase().startsWith(q) || (q.length >= 3 && c.name.toUpperCase().includes(q)))
    .slice(0, 3)
    .map((c) => ({ value: c.code, code: c.code, detail: `${c.name} — whole country` }));
  const as = searchAirports(airports, query, limit - cs.length, preferred)
    .map((a) => ({ value: a.iata, code: a.iata, detail: `${a.city}, ${a.country} — ${a.name}` }));
  return [...cs, ...as];
}

const COUNTRY_ALIASES = { UK: "GB", "GREAT BRITAIN": "GB", ENGLAND: "GB", USA: "US", AMERICA: "US", UAE: "AE", "SOUTH KOREA": "KR", KOREA: "KR", RUSSIA: "RU" };

/** Resolve typed text to an avoid entry (country code or airport code), or null. */
export function resolvePlace(map, airports, countries, value, preferred) {
  const v = (value || "").trim(), up = v.toUpperCase();
  if (!v) return null;
  if (COUNTRY_ALIASES[up]) return COUNTRY_ALIASES[up];
  const byCode = countries.find((c) => c.code === up);
  if (byCode) return byCode.code;
  const byName = countries.find((c) => c.name.toUpperCase() === up);
  if (byName) return byName.code;
  const airport = resolveAirport(map, airports, v, preferred);
  if (airport) return airport;
  // Partial country name ("Germ" → DE), matching what the autocomplete offers.
  const q = up.length >= 3 ? countries.find((c) => c.name.toUpperCase().startsWith(up)) : null;
  return q ? q.code : null;
}

// ---------------------------------------------------------------------------
// Geography & hub suggestions
// ---------------------------------------------------------------------------
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export const dist = (map, a, b) => haversine(map[a].lat, map[a].lon, map[b].lat, map[b].lon);

// Extra route distance allowed via a hub, as a fraction of the direct distance. On-route hubs
// (≤30%) are preferred; the limit widens step by step only when too few hubs match the
// country/continent preference.
export const DETOUR_STEPS = [0.3, 0.6, 1.0, 2.0];
export const MAX_DETOUR = DETOUR_STEPS[0];
const HUB_POOL = 12;

export const CONTINENTS = [
  ["any", "Any continent"], ["north-america", "North America & Caribbean"], ["south-america", "South America"],
  ["europe", "Europe"], ["asia", "Asia & Middle East"], ["africa", "Africa"], ["oceania", "Oceania"],
];
const CONTINENT_COUNTRIES = {
  "north-america": "US CA MX AG AW BB BM BQ BS BZ CR CU CW DO GD GT HN HT JM LC NI PA PR SV SX TT VI",
  "south-america": "AR BO BR CL CO EC GY PE PY SR UY VE",
  europe: "AL AT BE BG BY CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LT LU LV MD MK MT NL NO PL PT RO RS RU SE SI SK TR UA",
  asia: "AE AM AZ BD BH CN GE HK ID IL IN IQ IR JO JP KG KH KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK QA SA SG SY TH TM TW UZ VN YE",
  africa: "AO CI CV DZ EG ET GH KE LY MA MU MZ NA NG RE SD SL SN SS TN TZ UG ZA ZM ZW",
  oceania: "AU FJ GU NZ PF VU",
};
export const COUNTRY_CONTINENT = {};
Object.entries(CONTINENT_COUNTRIES).forEach(([cont, list]) => list.split(" ").forEach((c) => { COUNTRY_CONTINENT[c] = cont; }));
const CONTINENT_KEYS = CONTINENTS.map((c) => c[0]);

function countryOk(country, pref, originCountry) {
  if (pref === "same") return country === originCountry;
  if (pref === "different") return country !== originCountry;
  return true;
}

/**
 * Hubs between `from` and `to` matching the country/continent preference, least detour first.
 * Starts with on-route hubs and widens the allowed detour (DETOUR_STEPS) until `count` are found.
 */
export function hubCandidates(hubs, map, from, to, { exclude = [], skip = () => false, country = "any", continent = "any", originCountry = null, count = HUB_POOL, maxDetour = Infinity } = {}) {
  if (!map[from] || !map[to]) return [];
  const direct = dist(map, from, to);
  if (direct < 100) return [];
  const all = hubs
    .filter((h) => map[h.code] && !exclude.includes(h.code) && !skip(h.code))
    .map((h) => ({ ...h, country: map[h.code].country, detour: (dist(map, from, h.code) + dist(map, h.code, to)) / direct }))
    .filter((h) => countryOk(h.country, country, originCountry ?? map[from].country))
    .filter((h) => continent === "any" || COUNTRY_CONTINENT[h.country] === continent)
    .filter((h) => h.detour <= maxDetour)
    .sort((a, b) => a.detour - b.detour);
  for (const m of DETOUR_STEPS) {
    const within = all.filter((h) => h.detour <= 1 + m);
    if (within.length >= count || m === DETOUR_STEPS[DETOUR_STEPS.length - 1]) return within.slice(0, count);
  }
  return [];
}

/**
 * Choose one distinct hub per "suggest" slot in the segment from → to.
 * `variant` rotates through each slot's candidate list; `skip(code)` rejects hubs
 * (avoided places, cities already used). No two picks share a city.
 * Returns an array (same length as slots) of hubs or null, with the chosen
 * hubs re-ordered by distance from `from` so the route never doubles back.
 */
export function pickHubsForSegment(hubs, map, from, to, slots, variant, originCountry, exclude = [], skip = () => false) {
  const used = new Set();
  const picked = slots.map((slot) => {
    const cands = hubCandidates(hubs, map, from, to, { exclude, skip, country: slot.country, continent: slot.continent || "any", originCountry, maxDetour: slot.maxDetour });
    for (let i = 0; i < cands.length; i++) {
      const h = cands[(variant + i) % cands.length];
      const key = locationKey(map, h.code);
      if (!used.has(key)) { used.add(key); return h; }
    }
    return null;
  });
  const chosen = picked.filter(Boolean).sort((a, b) => dist(map, from, a.code) - dist(map, from, b.code));
  let k = 0;
  return picked.map((p) => (p ? chosen[k++] : null));
}

/** Airports within `maxKm` of `code` (excluding it), closest first. */
export function nearbyAirports(list, map, code, maxKm = 250, count = 3) {
  const a = map[code];
  if (!a) return [];
  return list
    .filter((b) => b.iata !== code)
    .map((b) => ({ code: b.iata, dist: haversine(a.lat, a.lon, b.lat, b.lon) }))
    .filter((b) => b.dist <= maxKm)
    .sort((x, y) => x.dist - y.dist)
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Cost estimate & currency
// ---------------------------------------------------------------------------
export const CABIN_MULT = { economy: 1, "premium-economy": 1.6, business: 3.2, first: 5.5 };
// Rough day-of-week effect: midweek and Saturday departures tend to be cheaper (Sun..Sat).
export const DOW_FACTOR = [1.08, 1.0, 0.92, 0.92, 1.0, 1.1, 0.95];

/** Rough fare in USD for all passengers; `date` (optional) applies the day-of-week factor. */
export function estimateCost(map, from, to, cabin, pax, date) {
  if (!map[from] || !map[to]) return null;
  const d = dist(map, from, to);
  const rate = d < 500 ? 0.25 : d < 1500 ? 0.15 : d < 4000 ? 0.1 : d < 8000 ? 0.08 : 0.07;
  const dow = date ? DOW_FACTOR[parseISO(date).getDay()] : 1;
  const seat = Math.max(45, d * rate) * (CABIN_MULT[cabin] || 1) * dow;
  return Math.round(seat * pax.adults);
}

// Approximate, fixed exchange rates (USD base). Estimates only.
export const CURRENCIES = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.38, AUD: 1.52, MXN: 18, JPY: 150, INR: 84, AED: 3.67 };
export function formatMoney(usd, currency = "USD") {
  const rate = CURRENCIES[currency] || 1;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(usd * rate);
}

// ---------------------------------------------------------------------------
// Itinerary generation
// ---------------------------------------------------------------------------
export const MIN_RESULTS = 8, MAX_RESULTS = 12;
const MAX_DATE_SHIFT = 14;

/**
 * @returns {{itineraries: Array, warnings: string[]}}
 * Every airport code passed in must exist in `map` (validate first).
 * `avoid` lists places never to use (see avoidChecker): they're skipped for suggested stops
 * and nearby-airport extras, and itineraries starting or ending there aren't built.
 *
 * Suggested stops never repeat across itineraries: each itinerary takes the least-detour hubs
 * whose city hasn't been shown yet, so every result offers new stopover cities. Airport
 * combinations are filled round-robin until MAX_RESULTS or the hubs run out. If that gives fewer
 * than MIN_RESULTS, nearby departure/arrival airports (needs `airports`) and then the whole trip
 * shifted a few days earlier/later (never before `today`) are added. Each such extra has a `note`.
 */
export function buildItineraries({ map, hubs, airports = [], depAirports, arrAirports = [], stops, depart, end, returnHome = false, cabin, pax, today = null, avoid = [] }) {
  const warnings = new Set();
  const hasSuggest = stops.some((s) => s.mode === "suggest");
  const fixedCodes = stops.filter((s) => s.mode === "fixed").map((s) => s.airport);
  const isAvoided = avoidChecker(map, avoid);
  const usedStops = new Set(); // cities already shown as a suggested stop in an earlier itinerary
  // Cities the traveller already flies from/to/through are never offered as a suggested stop
  // (e.g. with alternates MCO and TPA, a Tampa trip mustn't be routed via Orlando).
  const ownCities = new Set([...depAirports, ...arrAirports, ...fixedCodes].map((c) => locationKey(map, c)));
  const best = new Map();

  // returnHome: the final destination is the departure airport (dep → stops → dep).
  function build(dep, arr, shift = 0, note = "") {
    if (returnHome) arr = dep;
    else if (dep === arr) return null;
    if (isAvoided(dep) || isAvoided(arr)) return null;
    const start = addDays(depart, shift);
    if (today && start < today) return null;
    const originCountry = map[dep].country;
    const exclude = [dep, arr, ...fixedCodes];
    const taken = new Set(); // cities used by this itinerary's suggested stops
    let exhausted = false;
    // Split stops into segments between fixed anchors and fill each segment's suggest slots.
    const resolved = [];
    let anchor = dep, pending = [];
    const flush = (to) => {
      if (!pending.length) return;
      const own = (c) => { const k = locationKey(map, c); return isAvoided(c) || taken.has(k) || ownCities.has(k) || k === locationKey(map, dep) || k === locationKey(map, arr); };
      const fresh = (c) => own(c) || usedStops.has(locationKey(map, c));
      // Fresh (not yet shown) stop cities may detour no further than the best choices needed:
      // fewer results beats suggesting far-off stopovers.
      const slots = pending.map((slot) => {
        const best = hubCandidates(hubs, map, anchor, to, { exclude, skip: own, country: slot.country, continent: slot.continent || "any", originCountry });
        const worst = best.length ? best[best.length - 1].detour : Infinity;
        const step = DETOUR_STEPS.findIndex((m) => worst <= 1 + m + 1e-9);
        return { ...slot, maxDetour: step < 0 ? Infinity : 1 + DETOUR_STEPS[step] };
      });
      const picks = pickHubsForSegment(hubs, map, anchor, to, slots, 0, originCountry, exclude, fresh);
      const ignoringUsed = picks.some((h) => !h) ? pickHubsForSegment(hubs, map, anchor, to, pending, 0, originCountry, exclude, own) : picks;
      picks.forEach((h, i) => {
        if (h) { taken.add(locationKey(map, h.code)); resolved.push({ code: h.code, date: null, suggested: true, hub: h }); }
        else if (ignoringUsed[i]) exhausted = true; // only fillable with a city another itinerary already shows
        else warnings.add(`Couldn't find a stopover city for stop ${pending[i].index + 1} — the route may be too short, or the country/continent filter or places to avoid too strict, so it was left out.`);
      });
      pending = [];
    };
    stops.forEach((s, index) => {
      if (s.mode === "suggest") pending.push({ ...s, index });
      else { flush(s.airport); resolved.push({ code: s.airport, date: s.date ? addDays(s.date, shift) : null, suggested: false }); anchor = s.airport; }
    });
    flush(arr);
    if (exhausted) return null;

    // Drop stops that repeat the previous airport or equal the destination.
    const route = [];
    let prev = dep;
    resolved.forEach((s, i) => {
      const next = i === resolved.length - 1 ? arr : null;
      if (s.code !== prev && s.code !== next) { route.push(s); prev = s.code; }
    });

    if (!route.length && dep === arr) return null;
    const codes = [dep, ...route.map((s) => s.code), arr];
    const dates = scheduleDates(start, addDays(end, shift), route.map((s) => s.date));
    const legs = [];
    for (let i = 0; i < codes.length - 1; i++) {
      const to = route[i];
      legs.push({
        from: codes[i], to: codes[i + 1], date: dates[i],
        cost: estimateCost(map, codes[i], codes[i + 1], cabin, pax, dates[i]),
        suggested: !!(to && to.suggested), hub: to ? to.hub || null : null,
        isReturn: returnHome && i === codes.length - 2,
      });
    }
    const totalCost = legs.reduce((sum, l) => sum + (l.cost || 0), 0);
    const stopCities = route.filter((s) => s.suggested).map((s) => locationKey(map, s.code));
    return { legs, codes, totalCost, note, dep, arr, stopCities, key: codes.join(">") + "|" + dates.join(",") };
  }
  const add = (it) => {
    if (!it || (best.has(it.key) && best.get(it.key).totalCost <= it.totalCost)) return false;
    best.set(it.key, it);
    it.stopCities.forEach((c) => usedStops.add(c));
    return true;
  };

  // 1. Requested airports. With suggested stops, go round-robin so every combination gets new stop cities.
  const combos = depAirports.flatMap((dep) => (returnHome ? [dep] : arrAirports).map((arr) => [dep, arr]));
  if (hasSuggest) {
    for (let round = 0; round < MAX_RESULTS && best.size < MAX_RESULTS; round++) {
      let added = false;
      for (const [dep, arr] of combos) if (best.size < MAX_RESULTS && add(build(dep, arr))) added = true;
      if (!added) break;
    }
  } else combos.forEach(([dep, arr]) => add(build(dep, arr)));

  const base = [...best.values()].sort((a, b) => a.totalCost - b.totalCost)[0];
  // 2. Too few: nearby departure / arrival airports (never an avoided place)
  if (base && best.size < MIN_RESULTS) {
    const tried = new Set([...depAirports, ...arrAirports, ...fixedCodes]);
    for (const n of nearbyAirports(airports, map, base.dep)) {
      if (!tried.has(n.code) && !isAvoided(n.code)) add(build(n.code, base.arr, 0, `Nearby departure airport (${Math.round(n.dist)} km from ${base.dep})`));
    }
    if (!returnHome) for (const n of nearbyAirports(airports, map, base.arr)) {
      if (!tried.has(n.code) && !isAvoided(n.code)) add(build(base.dep, n.code, 0, `Nearby arrival airport (${Math.round(n.dist)} km from ${base.arr})`));
    }
  }
  // 3. Still too few: flexible dates (whole trip shifted)
  if (base) {
    for (let d = 1; d <= MAX_DATE_SHIFT && best.size < MIN_RESULTS; d++) {
      for (const shift of [d, -d]) {
        if (best.size >= MIN_RESULTS) break;
        add(build(base.dep, base.arr, shift, `Flexible dates: ${d} day${d > 1 ? "s" : ""} ${shift < 0 ? "earlier" : "later"}`));
      }
    }
  }

  const itineraries = [...best.values()].sort((a, b) => a.totalCost - b.totalCost).slice(0, MAX_RESULTS);
  return { itineraries, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------
// Booking links
// ---------------------------------------------------------------------------
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function paxPhrase(pax) {
  return plural(pax.adults, "adult", "adults");
}

export function googleFlightsUrl(from, to, date, cabin, pax, currency = "USD") {
  const cabinStr = { economy: "", "premium-economy": " premium economy", business: " business class", first: " first class" }[cabin] || "";
  const who = pax.adults > 1 ? ` for ${paxPhrase(pax)}` : "";
  const q = `Flights from ${from} to ${to} on ${date} one way${cabinStr}${who}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${currency}`;
}

const NA = ["US", "CA", "MX", "PR", "BS", "JM", "DO", "AW", "KY", "TC", "BB", "LC", "AG", "SX", "VI", "CR", "BZ", "GT", "SV", "HN", "PA"];
const EU = ["GB", "FR", "DE", "NL", "ES", "IT", "CH", "AT", "BE", "PT", "IE", "SE", "NO", "DK", "FI", "PL", "CZ", "HU", "GR", "RO", "BG", "HR", "IS", "LU", "MT", "CY", "SK", "SI", "EE", "LV", "LT", "RS"];
const ME = ["AE", "QA", "TR", "SA", "BH", "KW", "OM", "JO", "IL", "EG"];
const ASIA = ["JP", "KR", "CN", "SG", "TH", "MY", "ID", "PH", "VN", "IN", "HK", "TW", "AU", "NZ", "LK", "MV", "KH"];
const inR = (a, list) => !!a && list.includes(a.country);
const either = (o, d, f) => f(o) || f(d);
const both = (o, d, f) => f(o) && f(d);

const ymd = (date) => date.split("-");
const mdy = (date) => { const [y, m, d] = ymd(date); return `${m}%2F${d}%2F${y}`; };

// Each airline: where it plausibly flies (`serves`) and how to build a search link.
// Deep links are best-effort and may need updating when airlines change their sites.
export const AIRLINES = [
  { key: "delta", name: "Delta", home: "NA", serves: (o, d) => either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => `https://www.delta.com/flight-search/search?action=findFlights&tripType=ONE_WAY&originCity=${o}&destinationCity=${d}&departureDate=${mdy(date)}&paxCount=${p.adults}&searchByCabin=true` },
  { key: "american", name: "American", home: "NA", serves: (o, d) => either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => { const slices = JSON.stringify([{ orig: o, origNearby: false, dest: d, destNearby: false, date }]); return `https://www.aa.com/booking/search?locale=en_US&pax=${p.adults}&adult=${p.adults}&type=OneWay&searchType=Revenue&cabin=&carriers=ALL&slices=${encodeURIComponent(slices)}`; } },
  { key: "united", name: "United", home: "NA", serves: (o, d) => either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => `https://www.united.com/en/us/fsr/choose-flights?f=${o}&t=${d}&d=${date}&tt=1&sc=7&px=${p.adults}` },
  { key: "jetblue", name: "JetBlue", home: "NA",
    serves: (o, d) => both(o, d, (a) => inR(a, NA)) || (either(o, d, (a) => inR(a, ["US"])) && either(o, d, (a) => inR(a, ["GB", "FR", "IE", "NL"]))),
    url: (o, d, date, p) => `https://www.jetblue.com/booking/flights?from=${o}&to=${d}&depart=${date}&isMultiCity=false&noOfRoute=1&lang=en&adults=${p.adults}&sharedMarket=false&roundTripFares=false` },
  { key: "southwest", name: "Southwest", home: "NA", serves: (o, d) => both(o, d, (a) => inR(a, NA)) && either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => `https://www.southwest.com/air/booking/select.html?originationAirportCode=${o}&destinationAirportCode=${d}&departureDate=${date}&tripType=oneway&adultPassengersCount=${p.adults}&fareType=USD` },
  { key: "alaska", name: "Alaska", home: "NA", serves: (o, d) => both(o, d, (a) => inR(a, NA)) && either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => `https://www.alaskaair.com/shopping/flights?tripType=ow&adults=${p.adults}&prior=AS&departureCity=${o}&arrivalCity=${d}&departureDate=${mdy(date)}` },
  { key: "frontier", name: "Frontier", home: "NA", serves: (o, d) => both(o, d, (a) => inR(a, NA)) && either(o, d, (a) => inR(a, ["US"])),
    url: (o, d, date, p) => { const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; const [, m, dd] = ymd(date); return `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${o}&d1=${d}&dd1=${mon[+m - 1]}+${+dd}&ADT=${p.adults}&mon=true&r=false`; } },
  { key: "aircanada", name: "Air Canada", home: "NA", serves: (o, d) => either(o, d, (a) => inR(a, ["CA"])),
    url: (o, d, date, p, c) => `https://flightbookings.aircanada.com/en-us/#/search?legs=${o}:${d}::${date}&pax=${p.adults}:0:0:0:0:0&cabin=${{ economy: "economy", "premium-economy": "premiumEconomy", business: "business", first: "business" }[c]}` },
  { key: "british", name: "British Airways", home: "EU", serves: (o, d) => either(o, d, (a) => inR(a, EU)),
    url: (o, d, date, p, c) => `https://www.britishairways.com/travel/book/public/en_us?eId=111091&from=${o}&to=${d}&depDate=${date}&cabin=${{ economy: "M", "premium-economy": "W", business: "C", first: "F" }[c]}&ad=${p.adults}&yf=0&ch=0&inf=0&trip=ow` },
  { key: "lufthansa", name: "Lufthansa", home: "EU", serves: (o, d) => either(o, d, (a) => inR(a, EU)),
    url: (o, d, date, p) => `https://www.lufthansa.com/us/en/select-flights?searchType=ONEWAY&cbm=ECO&li=0&pax=a${p.adults}&segments=${o}-${d}-${date}` },
  { key: "airfrance", name: "Air France", home: "EU", serves: (o, d) => either(o, d, (a) => inR(a, EU)),
    url: (o, d, date, p, c) => `https://www.airfrance.us/search/offer?pax=${p.adults}:0:0:0:0:0:0:0&cabinClass=${{ economy: "ECONOMY", "premium-economy": "PREMIUM", business: "BUSINESS", first: "FIRST" }[c]}&activeConnection=0&connections=${o}>${d}-${date}` },
  { key: "klm", name: "KLM", home: "EU", serves: (o, d) => either(o, d, (a) => inR(a, EU)),
    url: (o, d, date, p, c) => `https://www.klm.us/search/offer?pax=${p.adults}:0:0:0:0:0:0:0&cabinClass=${{ economy: "ECONOMY", "premium-economy": "PREMIUM", business: "BUSINESS", first: "BUSINESS" }[c]}&activeConnection=0&connections=${o}>${d}-${date}` },
  { key: "turkish", name: "Turkish Airlines", home: "ME", serves: (o, d, km) => either(o, d, (a) => inR(a, ME) || inR(a, EU)) || km > 5000,
    url: (o, d, date, p) => `https://www.turkishairlines.com/en-us/flights/?origin=${o}&destination=${d}&departureDate=${date}&adult=${p.adults}&tripType=O&cabin=E` },
  { key: "emirates", name: "Emirates", home: "ME", serves: (o, d, km) => either(o, d, (a) => inR(a, ME)) || km > 5000,
    url: (o, d, date, p) => `https://www.emirates.com/us/english/book/flights/?from=${o}&to=${d}&departing=${date}&pax=${p.adults}&class=ECO&triptype=OW` },
  { key: "qatar", name: "Qatar Airways", home: "ME", serves: (o, d, km) => either(o, d, (a) => inR(a, ME)) || km > 5000,
    url: (o, d, date, p, c) => `https://www.qatarairways.com/en-us/booking/book-flights.html?from=${o}&to=${d}&departing=${date}&adults=${p.adults}&travelClass=${{ economy: "Economy", "premium-economy": "Economy", business: "Business", first: "First" }[c]}&tripType=O` },
  { key: "singapore", name: "Singapore Airlines", home: "ASIA", serves: (o, d) => either(o, d, (a) => inR(a, ASIA)),
    url: (o, d, date, p, c) => `https://www.singaporeair.com/en_UK/plan-and-book/booking/?from=${o}&to=${d}&departDate=${date}&cabinClass=${{ economy: "Y", "premium-economy": "S", business: "J", first: "F" }[c]}&adult=${p.adults}&type=one-way` },
  { key: "cathay", name: "Cathay Pacific", home: "ASIA", serves: (o, d) => either(o, d, (a) => inR(a, ASIA)),
    url: (o, d, date, p, c) => `https://www.cathaypacific.com/cx/en_US/book-a-trip/flight-search.html?origin=${o}&destination=${d}&departDate=${date}&cabin=${{ economy: "Y", "premium-economy": "W", business: "J", first: "F" }[c]}&adults=${p.adults}&tripType=OW` },
];

const regionOf = (a) => (inR(a, NA) ? "NA" : inR(a, EU) ? "EU" : inR(a, ME) ? "ME" : inR(a, ASIA) ? "ASIA" : "OTHER");

/** Airlines likely to fly this route, most relevant first (home region of the origin, then destination). */
export function airlinesForRoute(map, from, to) {
  const o = map[from], d = map[to];
  const km = o && d ? dist(map, from, to) : 0;
  let list = AIRLINES.filter((a) => a.serves(o, d, km));
  if (!list.length) list = AIRLINES.filter((a) => ["delta", "united", "emirates", "turkish"].includes(a.key));
  const ro = regionOf(o), rd = regionOf(d);
  const rank = (a) => (a.home === ro ? 0 : a.home === rd ? 1 : 2);
  return list.map((a, i) => [a, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map((x) => x[0]);
}

export function airlineLinks(map, from, to, date, cabin, pax) {
  const p = { adults: pax.adults };
  return airlinesForRoute(map, from, to).map((a) => ({ key: a.key, name: a.name, url: a.url(from, to, date, p, cabin) }));
}

// ---------------------------------------------------------------------------
// Sharing: form state <-> URL query string
// ---------------------------------------------------------------------------
export const DEFAULT_STATE = {
  origin: "MCO", destination: "", depAlts: [], arrAlts: [], depart: "", end: "", returnHome: false,
  adults: 1, cabin: "economy", currency: "USD", stops: [], avoid: [],
};
export const MAX_AVOID = 10;

export function serializeState(s) {
  const p = new URLSearchParams();
  p.set("from", s.origin);
  if (s.returnHome) p.set("home", "1"); else p.set("to", s.destination);
  if (s.depAlts.length) p.set("fromAlt", s.depAlts.join(","));
  if (!s.returnHome && s.arrAlts.length) p.set("toAlt", s.arrAlts.join(","));
  if (s.depart) p.set("depart", s.depart);
  if (s.end) p.set("end", s.end);
  p.set("adults", s.adults);
  if (s.cabin !== "economy") p.set("cabin", s.cabin);
  if (s.currency !== "USD") p.set("cur", s.currency);
  if (s.stops.length) p.set("stops", s.stops.map((st) => st.mode === "suggest" ? `suggest:${st.country}${st.continent && st.continent !== "any" ? `:${st.continent}` : ""}` : `${st.airport}:${st.date || ""}`).join(";"));
  if (s.avoid && s.avoid.length) p.set("avoid", s.avoid.join(","));
  return p.toString();
}

const intIn = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt; };
const code3 = (v) => (/^[A-Za-z]{3}$/.test(v || "") ? v.toUpperCase() : "");

/** Parse a query string back into form state; unknown or malformed values fall back to defaults. */
export function parseState(query) {
  const p = new URLSearchParams(query);
  if (!p.has("from") && !p.has("to")) return null;
  const list = (k) => (p.get(k) || "").split(",").map(code3).filter(Boolean).slice(0, 3);
  const stops = (p.get("stops") || "").split(";").filter(Boolean).slice(0, 4).map((x) => {
    const [a, b, c] = x.split(":");
    if (a === "suggest") return { mode: "suggest", airport: "", date: "", country: ["any", "same", "different"].includes(b) ? b : "any", continent: CONTINENT_KEYS.includes(c) ? c : "any" };
    return { mode: "fixed", airport: code3(a), date: isISODate(b) ? b : "", country: "any", continent: "any" };
  });
  let returnHome = p.get("home") === "1", destination = (p.get("to") || "").slice(0, 60);
  // Links from before the trip-type toggle was removed: a round trip A → … → B → A becomes
  // A → … → B (as a stop) → A, which schedules the same flights.
  if (p.get("trip") === "round" && !returnHome && stops.length < 4) {
    stops.push({ mode: "fixed", airport: code3(destination) || destination, date: "", country: "any", continent: "any" });
    returnHome = true;
  }
  if (returnHome) destination = "";
  const adults = intIn(p.get("adults"), 1, 9, 1);
  return {
    ...DEFAULT_STATE,
    origin: (p.get("from") || "").slice(0, 60), destination, returnHome,
    depAlts: list("fromAlt"), arrAlts: returnHome ? [] : list("toAlt"),
    depart: isISODate(p.get("depart")) ? p.get("depart") : "", end: isISODate(p.get("end")) ? p.get("end") : "",
    adults,
    // hasOwn: "constructor", "toString"… must not pass as a cabin or currency
    cabin: Object.hasOwn(CABIN_MULT, p.get("cabin") ?? "") ? p.get("cabin") : "economy",
    currency: Object.hasOwn(CURRENCIES, p.get("cur") ?? "") ? p.get("cur") : "USD",
    stops,
    avoid: [...new Set((p.get("avoid") || "").split(",").filter((x) => /^[A-Za-z]{2,3}$/.test(x)).map((x) => x.toUpperCase()))].slice(0, MAX_AVOID),
  };
}

// ---------------------------------------------------------------------------
// Export: plain text & iCalendar
// ---------------------------------------------------------------------------
export function formatDate(s) {
  return parseISO(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function itineraryToText(itin, map, { cabin, pax, currency }) {
  const lines = [`Trip: ${itin.codes.map((c) => airportLabel(map, c)).join(" → ")}`, ...(itin.note ? [itin.note] : []),
    `Estimated total: ~${formatMoney(itin.totalCost, currency)} (${paxPhrase(pax)}, ${cabin.replace("-", " ")})`, ""];
  itin.legs.forEach((l, i) => {
    lines.push(`Leg ${i + 1}${l.isReturn ? " (return)" : ""}: ${airportLabel(map, l.from)} → ${airportLabel(map, l.to)} — ${formatDate(l.date)} — ~${formatMoney(l.cost || 0, currency)}`);
    lines.push(`  Search: ${googleFlightsUrl(l.from, l.to, l.date, cabin, pax, currency)}`);
  });
  lines.push("", "Estimates are approximate. Each leg is booked separately.");
  return lines.join("\n");
}

const icsEscape = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
const icsDate = (s) => s.replace(/-/g, "");

export function itineraryToICS(itin, map, { cabin, pax, currency }, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Plan My Trip//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  itin.legs.forEach((l, i) => {
    out.push("BEGIN:VEVENT",
      `UID:${itin.key.replace(/[^A-Z0-9]/gi, "")}-${i}@plan-my-trip`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(l.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(l.date, 1))}`,
      `SUMMARY:${icsEscape(`✈ ${l.from} → ${l.to}${l.isReturn ? " (return)" : ""}`)}`,
      `DESCRIPTION:${icsEscape(`${airportLabel(map, l.from)} to ${airportLabel(map, l.to)}\nEstimated ~${formatMoney(l.cost || 0, currency)}\nSearch flights: ${googleFlightsUrl(l.from, l.to, l.date, cabin, pax, currency)}`)}`,
      "TRANSP:TRANSPARENT", "END:VEVENT");
  });
  out.push("END:VCALENDAR");
  return out.join("\r\n") + "\r\n";
}
