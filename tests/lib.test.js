import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/airports.js";
import "../js/hubs.js";
import "../js/lib.js";

// The browser scripts publish globals (they're plain scripts so file:// works).
const L = globalThis.PlanMyTrip;
const { airports, hubs } = globalThis.PlanMyTripData;
const map = L.indexAirports(airports);
const pax1 = { adults: 1 };
const requested = (its) => its.filter((i) => !i.note); // exclude nearby-airport / flexible-date extras
const base = { map, hubs, airports, depart: "2026-12-10", end: "2026-12-17", cabin: "economy", pax: pax1 };

test("data: every hub exists in airports.json", () => {
  for (const h of hubs) assert.ok(map[h.code], `hub ${h.code} missing from airports.json`);
});

// --- Dates -----------------------------------------------------------------
test("dates: local ISO helpers don't drift across DST or month ends", () => {
  assert.equal(L.addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(L.addDays("2026-03-08", 1), "2026-03-09"); // US DST starts
  assert.equal(L.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.daysBetween("2026-03-01", "2026-04-01"), 31);
  assert.equal(L.todayISO(new Date(2026, 10, 19, 23, 30)), "2026-11-19"); // late evening stays "today"
});

test("scheduleDates: the last leg flies on the end date and stops spread between", () => {
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-17", []), ["2026-12-10"]);
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-17", [null]), ["2026-12-10", "2026-12-17"]);
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-16", [null, null]), ["2026-12-10", "2026-12-13", "2026-12-16"]);
});

test("scheduleDates: fixed dates are kept and the rest interpolate around them", () => {
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-20", [null, "2026-12-12", null, null]),
    ["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-16", "2026-12-20"]);
});

test("validateStopDates catches out-of-range and out-of-order dates", () => {
  assert.equal(L.validateStopDates("2026-12-10", "2026-12-17", ["2026-12-12", "", "2026-12-15"], true), null);
  assert.match(L.validateStopDates("2026-12-10", "2026-12-17", ["2026-12-27"], true), /after your end date/);
  assert.match(L.validateStopDates("2026-12-10", "2026-12-17", ["2026-12-05"], true), /before your departure/);
  assert.match(L.validateStopDates("2026-12-10", "2026-12-17", ["2026-12-14", "2026-12-12"], true), /before stop 1/);
});

// --- Airports ----------------------------------------------------------------
test("resolveAirport accepts codes, city names and airport names", () => {
  assert.equal(L.resolveAirport(map, airports, "jfk"), "JFK");
  const hubSet = new Set(hubs.map((h) => h.code));
  assert.equal(L.resolveAirport(map, airports, "London", hubSet), "LHR"); // major hub wins ties
  assert.equal(L.resolveAirport(map, airports, "new york", hubSet), "JFK");
  assert.equal(map[L.resolveAirport(map, airports, "london")].city, "London");
  assert.equal(L.resolveAirport(map, airports, "Heathrow"), "LHR");
  assert.equal(L.resolveAirport(map, airports, "ZZZ"), null);
  assert.equal(L.resolveAirport(map, airports, "Nowhereville"), null);
});

test("searchAirports ranks exact code, then city matches", () => {
  assert.equal(L.searchAirports(airports, "MIA")[0].iata, "MIA");
  const ny = L.searchAirports(airports, "New York");
  assert.deepEqual(ny.slice(0, 2).map((a) => a.iata).sort(), ["JFK", "LGA"]); // city matches before name matches (SWF "New York Stewart")
});

// --- Itineraries -------------------------------------------------------------
test("two suggested stops give two distinct stops, ordered along the route", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["SIN"],
    stops: [{ mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }] });
  assert.ok(itineraries.length > 1);
  for (const it of itineraries) {
    assert.equal(it.codes.length, 4, it.codes.join(">"));
    assert.equal(new Set(it.codes).size, 4);
    assert.ok(L.dist(map, "MCO", it.codes[1]) <= L.dist(map, "MCO", it.codes[2]), `doubles back: ${it.codes}`);
  }
});

test("suggested stop that can't be filled produces a warning", () => {
  const { itineraries, warnings } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["MIA"],
    stops: [{ mode: "suggest", country: "any" }] });
  assert.deepEqual(requested(itineraries)[0].codes, ["MCO", "MIA"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /stop 1/);
});

test("country filter is respected", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"],
    stops: [{ mode: "suggest", country: "different" }] });
  for (const it of itineraries) assert.notEqual(map[it.codes[1]].country, "US");
});

const homeStop = { mode: "fixed", airport: "LHR", date: "" };
test("returning home ends the trip at the departure airport on the end date", () => {
  const { itineraries } = L.buildItineraries({ ...base, returnHome: true, depAirports: ["MCO"], stops: [homeStop] });
  const [it] = requested(itineraries);
  assert.deepEqual(it.codes, ["MCO", "LHR", "MCO"]);
  assert.deepEqual(it.legs.map((l) => l.date), ["2026-12-10", "2026-12-17"]);
  assert.ok(it.legs[1].isReturn && !it.legs[0].isReturn);
});

test("returning home pairs each alternate departure airport with itself", () => {
  const its = requested(L.buildItineraries({ ...base, returnHome: true, depAirports: ["MCO", "TPA"], stops: [homeStop] }).itineraries);
  assert.deepEqual(its.map((i) => i.codes[0] + i.codes.at(-1)).sort(), ["MCOMCO", "TPATPA"]);
  assert.deepEqual(L.buildItineraries({ ...base, returnHome: true, depAirports: ["MCO"], stops: [] }).itineraries, []);
});

test("returning home can also fly back to an alternate arrival airport", () => {
  const its = requested(L.buildItineraries({ ...base, returnHome: true, depAirports: ["MCO"], arrAirports: ["TPA"], stops: [homeStop] }).itineraries);
  assert.deepEqual(its.map((i) => i.codes[0] + i.codes.at(-1)).sort(), ["MCOMCO", "MCOTPA"]);
  for (const it of its) assert.ok(it.legs.at(-1).isReturn);
});

test("fixed stop with date flies out on that date", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"],
    stops: [{ mode: "fixed", airport: "JFK", date: "2026-12-13" }] });
  assert.deepEqual(requested(itineraries)[0].legs.map((l) => [l.from, l.to, l.date]),
    [["MCO", "JFK", "2026-12-10"], ["JFK", "LHR", "2026-12-13"]]);
});

test("every leg has a cost and alternates are compared", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO", "TPA"], arrAirports: ["LHR", "LGW"], stops: [] });
  assert.equal(requested(itineraries).length, 4);
  for (const it of itineraries) for (const l of it.legs) assert.ok(l.cost > 0);
  const costs = itineraries.map((i) => i.totalCost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
});

test("estimateCost scales with cabin and travellers", () => {
  const one = L.estimateCost(map, "MCO", "LHR", "economy", pax1);
  assert.ok(Math.abs(L.estimateCost(map, "MCO", "LHR", "economy", { adults: 2 }) - one * 2) <= 1);
  assert.ok(L.estimateCost(map, "MCO", "LHR", "business", pax1) > one * 3);
});

// --- Booking links -----------------------------------------------------------
test("airline selection matches the route", () => {
  const keys = (o, d) => L.airlinesForRoute(map, o, d).map((a) => a.key);
  const transatlantic = keys("MCO", "LHR");
  assert.ok(!transatlantic.includes("southwest") && !transatlantic.includes("frontier"));
  assert.ok(transatlantic.includes("british") && transatlantic.includes("jetblue"));
  assert.ok(keys("MCO", "MIA").includes("southwest"));
  assert.equal(keys("LHR", "CDG")[0], "british"); // home-region carriers first
  assert.ok(keys("YYZ", "YVR").includes("aircanada"));
});

test("airline and Google links carry passengers, cabin and currency", () => {
  const pax = { adults: 2 };
  const links = Object.fromEntries(L.airlineLinks(map, "JFK", "LHR", "2026-12-10", "business", pax).map((l) => [l.key, l.url]));
  assert.match(links.british, /cabin=C&ad=2&yf=0&ch=0&inf=0/);
  assert.match(links.jetblue, /adults=2&sharedMarket/);
  const gf = decodeURIComponent(L.googleFlightsUrl("JFK", "LHR", "2026-12-10", "business", pax, "EUR"));
  assert.match(gf, /business class for 2 adults/);
  assert.match(gf, /curr=EUR/);
});

test("cost estimates sit near real one-way fares", () => {
  // Typical cheapest economy one-way fares seen on Google Flights / fare sites (USD, Nov 2026).
  const real = { "LAX-SFO": [25, 70], "ORD-DEN": [45, 90], "LHR-BCN": [35, 90], "YYZ-YVR": [75, 160], "JFK-LAX": [90, 170],
    "DEL-BOM": [40, 80], "MEX-CUN": [40, 110], "DXB-BKK": [150, 220], "JFK-LHR": [140, 260], "SIN-SYD": [150, 260], "JFK-NRT": [400, 700] };
  for (const [route, [lo, hi]] of Object.entries(real)) {
    const [o, d] = route.split("-");
    const est = L.estimateCost(map, o, d, "economy", pax1);
    assert.ok(est >= lo && est <= hi, `${route}: estimate ${est} outside ${lo}-${hi}`);
  }
});

test("likely cheapest airline prefers low-cost carriers that fly the route", () => {
  const cheap = (o, d, c) => L.cheapestAirline(map, o, d, c)?.key;
  assert.equal(cheap("STN", "DUB"), "ryanair");
  assert.notEqual(cheap("LHR", "CDG"), "ryanair"); // Ryanair doesn't fly Heathrow
  assert.equal(cheap("ORD", "DEN"), "frontier");
  assert.equal(cheap("YYZ", "YVR"), "flair");
  assert.equal(cheap("MEX", "CUN"), "volaris");
  assert.equal(cheap("SIN", "SYD"), "scoot");
  assert.equal(cheap("KUL", "BKK"), "airasia");
  assert.equal(L.cheapestAirline(map, "ORD", "DEN", "business").tier, 2); // full-service for business
  const link = L.cheapestAirlineLink(map, "STN", "DUB", "2026-12-10", "economy", { adults: 2 });
  assert.match(link.url, /^https:\/\/www\.ryanair\.com\/.*adults=2.*dateOut=2026-12-10.*originIata=STN&destinationIata=DUB/);
});

// --- Sharing & export --------------------------------------------------------
test("state round-trips through the URL and rejects junk", () => {
  const s = { ...L.DEFAULT_STATE, origin: "MCO", destination: "London", depAlts: ["TPA"], arrAlts: [], depart: "2026-12-10", end: "2026-12-20",
    returnHome: false, adults: 2, cabin: "business", currency: "GBP",
    stops: [{ mode: "fixed", airport: "JFK", date: "2026-12-12", country: "any", continent: "any" }, { mode: "suggest", airport: "", date: "", country: "different", continent: "europe" }] };
  assert.deepEqual(L.parseState(L.serializeState(s)), s);
  const junk = L.parseState("from=MCO&to=X&adults=99&cabin=<script>&cur=XXX&depart=tomorrow&stops=a:b;suggest:evil:mars");
  assert.equal(junk.adults, 1); assert.equal(junk.cabin, "economy"); assert.equal(junk.currency, "USD"); assert.equal(junk.depart, "");
  assert.deepEqual(junk.stops.map((x) => [x.mode, x.airport, x.country, x.continent]), [["fixed", "", "any", "any"], ["suggest", "", "any", "any"]]);
  assert.equal(L.parseState(""), null);
  const home = { ...s, destination: "", arrAlts: ["TPA"], returnHome: true };
  assert.deepEqual(L.parseState(L.serializeState(home)), home);
});

test("old round-trip links become a stop plus return home", () => {
  const s = L.parseState("from=MCO&to=LHR&trip=round&depart=2026-12-10&end=2026-12-17&stops=JFK:");
  assert.equal(s.returnHome, true); assert.equal(s.destination, "");
  assert.deepEqual(s.stops.map((x) => x.airport), ["JFK", "LHR"]);
  assert.equal(L.parseState("from=MCO&to=LHR&trip=oneway").returnHome, false);
});

test("text and calendar exports include every leg", () => {
  const [it] = requested(L.buildItineraries({ ...base, returnHome: true, depAirports: ["MCO"], stops: [homeStop] }).itineraries);
  const opts = { cabin: "economy", pax: pax1, currency: "USD" };
  const txt = L.itineraryToText(it, map, opts);
  assert.match(txt, /Leg 1: Orlando \(MCO\) → London \(LHR\)/);
  assert.match(txt, /Leg 2 \(return\)/);
  const ics = L.itineraryToICS(it, map, opts, new Date(Date.UTC(2026, 0, 1)));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261211/);
  assert.ok(ics.split("\r\n").every((line) => !line.includes("\n")));
});

test("formatMoney converts currency", () => {
  assert.equal(L.formatMoney(100, "USD"), "$100");
  assert.equal(L.formatMoney(100, "EUR"), "€92");
});

// --- Ported from main: continent filter, wider detours, minimum results, day-of-week pricing
test("continent preference is respected, widening the detour when needed", () => {
  const { itineraries, warnings } = L.buildItineraries({ ...base, depAirports: ["JFK"], arrAirports: ["LHR"],
    stops: [{ mode: "suggest", country: "any", continent: "africa" }] });
  assert.equal(warnings.length, 0);
  for (const it of requested(itineraries)) assert.equal(L.COUNTRY_CONTINENT[map[it.codes[1]].country], "africa", it.codes.join(">"));
});

test("on-route hubs are used before wider detours", () => {
  const c = L.hubCandidates(hubs, map, "MCO", "SIN", { count: 5 });
  assert.equal(c.length, 5);
  assert.ok(c.every((h) => h.detour <= 1 + L.MAX_DETOUR));
});

test("at least 8 itineraries, filled with nearby airports then flexible dates", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [], today: "2026-12-01" });
  assert.ok(itineraries.length >= L.MIN_RESULTS && itineraries.length <= L.MAX_RESULTS);
  assert.ok(itineraries.some((i) => /^Nearby (departure|arrival) airport/.test(i.note)));
  assert.ok(itineraries.every((i) => !i.note || /^(Nearby|Flexible dates)/.test(i.note)));
});

test("flexible dates never start before today", () => {
  const { itineraries } = L.buildItineraries({ ...base, depart: "2026-12-10", depAirports: ["MCO"], arrAirports: ["LHR"], stops: [], today: "2026-12-10", airports: [] });
  assert.ok(itineraries.length >= L.MIN_RESULTS);
  assert.ok(itineraries.every((i) => i.legs[0].date >= "2026-12-10"));
});

test("day-of-week factor: Wednesday cheaper than Friday", () => {
  const wed = L.estimateCost(map, "MCO", "LHR", "economy", pax1, "2026-12-09");
  const fri = L.estimateCost(map, "MCO", "LHR", "economy", pax1, "2026-12-11");
  assert.ok(wed < fri);
});

// --- Unique stops across itineraries & places to avoid ------------------------
const suggestedCities = (it) => it.legs.filter((l) => l.suggested).map((l) => L.locationKey(map, l.to));

test("suggested stop cities never repeat across itineraries", () => {
  for (const stops of [[{ mode: "suggest", country: "any" }], [{ mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }]]) {
    const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO", "TPA"], arrAirports: ["SIN", "KUL"], stops, today: "2026-12-01" });
    assert.ok(itineraries.length > 1);
    const all = itineraries.flatMap(suggestedCities);
    assert.equal(new Set(all).size, all.length, all.join(" "));
  }
});

test("unique stops also hold for nearby-airport and flexible-date extras", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["SIN"], today: "2026-12-01",
    stops: [{ mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }] });
  const all = itineraries.flatMap(suggestedCities);
  assert.equal(new Set(all).size, all.length, all.join(" "));
  for (const it of itineraries) assert.equal(it.codes.length, 5, it.codes.join(">"));
});

test("two suggested stops in one itinerary never share a city (e.g. NRT and HND)", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["SIN"], arrAirports: ["SEA"],
    stops: [{ mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }] });
  for (const it of itineraries) { const c = suggestedCities(it); assert.equal(new Set(c).size, c.length, it.codes.join(">")); }
});

test("avoided cities and countries are never suggested", () => {
  const avoid = ["LHR", "DE", "AE"]; // London (all airports), Germany, UAE
  const isAvoided = L.avoidChecker(map, avoid);
  assert.ok(isAvoided("LGW") && isAvoided("FRA") && isAvoided("DXB") && !isAvoided("CDG"));
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["JFK"], arrAirports: ["SIN"], avoid, today: "2026-12-01",
    stops: [{ mode: "suggest", country: "any" }, { mode: "suggest", country: "any" }] });
  assert.ok(itineraries.length > 0);
  for (const it of itineraries) for (const c of it.codes) assert.ok(!isAvoided(c), `${c} in ${it.codes.join(">")}`);
});

test("avoided places are not offered as nearby airports", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [], today: "2026-12-01", avoid: ["LGW", "STN"] });
  // avoiding LGW avoids all of London, so LHR itself is avoided: nothing is built
  assert.equal(itineraries.length, 0);
  const r = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [], today: "2026-12-01", avoid: ["TPA", "SFB"] });
  for (const it of r.itineraries) assert.ok(!["TPA", "SFB"].includes(it.dep), it.note);
});

test("places to avoid: search, resolve, label and URL state", () => {
  const countries = L.countryList(airports);
  assert.equal(L.resolvePlace(map, airports, countries, "Germany"), "DE");
  assert.equal(L.resolvePlace(map, airports, countries, "fr"), "FR");
  assert.equal(L.resolvePlace(map, airports, countries, "UK"), "GB");
  assert.equal(L.resolvePlace(map, airports, countries, "Paris"), "CDG");
  assert.equal(L.resolvePlace(map, airports, countries, "Heathrow"), "LHR");
  assert.equal(L.searchPlaces(countries, airports, "Japan")[0].value, "JP");
  assert.match(L.avoidLabel(map, airports, "LHR"), /London.*all airports/);
  assert.match(L.avoidLabel(map, airports, "RU"), /Russia \(whole country\)/);
  const s = { ...L.DEFAULT_STATE, origin: "MCO", destination: "SIN", avoid: ["LHR", "RU"] };
  assert.deepEqual(L.parseState(L.serializeState(s)).avoid, ["LHR", "RU"]);
  assert.deepEqual(L.parseState("from=MCO&to=SIN&avoid=lhr,<x>,ru,lhr").avoid, ["LHR", "RU"]);
});

test("avoid box: a partial country name resolves like the autocomplete suggests", () => {
  const countries = L.countryList(airports);
  assert.equal(L.resolvePlace(map, airports, countries, "Germ"), "DE");
  assert.equal(L.searchPlaces(countries, airports, "Ger")[0].value, "DE"); // not Algeria/Nigeria
  assert.equal(L.resolvePlace(map, airports, countries, "Paris"), "CDG"); // airports still win
  assert.equal(L.resolvePlace(map, airports, countries, "Par"), "PY"); // same as the first suggestion
  assert.equal(L.resolvePlace(map, airports, countries, "Zz"), null);
});

test("suggested stops never use a city the traveller already departs from, arrives at or stops in", () => {
  const stops = [{ mode: "fixed", airport: "KEF", date: "" }, { mode: "suggest", country: "any", continent: "any" }];
  const home = L.buildItineraries({ ...base, depAirports: ["MCO", "TPA"], stops, returnHome: true, today: "2026-12-01" });
  const own = new Set(["MCO", "TPA", "KEF"].map((c) => L.locationKey(map, c)));
  assert.ok(home.itineraries.length);
  for (const it of home.itineraries) for (const l of it.legs) if (l.suggested) assert.ok(!own.has(L.locationKey(map, l.to)), it.codes.join(">"));
  const oneWay = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [{ mode: "suggest", country: "any", continent: "europe" }], today: "2026-12-01" });
  for (const it of oneWay.itineraries) for (const l of it.legs) if (l.suggested) assert.notEqual(L.locationKey(map, l.to), L.locationKey(map, "LHR"));
});

test("parseState ignores prototype keys as cabin or currency", () => {
  const s = L.parseState("from=MCO&to=LHR&cur=constructor&cabin=toString");
  assert.equal(s.currency, "USD");
  assert.equal(s.cabin, "economy");
});

// --- Flight duration --------------------------------------------------------
test("duration: estimates flying time from distance, rounded to 5 minutes", () => {
  const lhrJfk = L.estimateFlightMinutes(map, "LHR", "JFK");
  assert.ok(lhrJfk >= 420 && lhrJfk <= 540, `LHR-JFK ${lhrJfk}min`);
  assert.equal(lhrJfk % 5, 0);
  const lhrCdg = L.estimateFlightMinutes(map, "LHR", "CDG");
  assert.ok(lhrCdg >= 45 && lhrCdg <= 90, `LHR-CDG ${lhrCdg}min`);
  assert.ok(L.estimateFlightMinutes(map, "LHR", "SYD") > lhrJfk);
  assert.equal(L.estimateFlightMinutes(map, "LHR", "???"), null);
});

test("duration: formats hours and minutes", () => {
  assert.equal(L.formatDuration(485), "8h 05m");
  assert.equal(L.formatDuration(45), "45m");
  assert.equal(L.formatDuration(120), "2h 00m");
  assert.equal(L.formatDuration(null), "");
});
