import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../js/lib.js";

const airports = JSON.parse(readFileSync(new URL("../airports.json", import.meta.url)));
const hubs = JSON.parse(readFileSync(new URL("../hub_cities.json", import.meta.url)));
const map = L.indexAirports(airports);
const pax1 = { adults: 1, children: 0, infants: 0 };
const base = { map, hubs, depart: "2026-12-10", end: "2026-12-17", roundTrip: false, cabin: "economy", pax: pax1 };

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

test("scheduleDates: round trip spreads stops and returns on end date", () => {
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-17", [], true), ["2026-12-10", "2026-12-17"]);
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-16", [null, null], true), ["2026-12-10", "2026-12-12", "2026-12-14", "2026-12-16"]);
});

test("scheduleDates: one way flies the last leg on the end date", () => {
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-17", [], false), ["2026-12-10"]);
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-17", [null], false), ["2026-12-10", "2026-12-17"]);
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-16", [null, null], false), ["2026-12-10", "2026-12-13", "2026-12-16"]);
});

test("scheduleDates: fixed dates are kept and the rest interpolate around them", () => {
  assert.deepEqual(L.scheduleDates("2026-12-10", "2026-12-20", [null, "2026-12-12", null], true),
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
  assert.deepEqual(itineraries[0].codes, ["MCO", "MIA"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /stop 1/);
});

test("country filter is respected", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"],
    stops: [{ mode: "suggest", country: "different" }] });
  for (const it of itineraries) assert.notEqual(map[it.codes[1]].country, "US");
});

test("round trip appends a return flight on the end date", () => {
  const { itineraries } = L.buildItineraries({ ...base, roundTrip: true, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [] });
  const [it] = itineraries;
  assert.deepEqual(it.codes, ["MCO", "LHR", "MCO"]);
  assert.deepEqual(it.legs.map((l) => l.date), ["2026-12-10", "2026-12-17"]);
  assert.ok(it.legs[1].isReturn);
});

test("fixed stop with date flies out on that date", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO"], arrAirports: ["LHR"],
    stops: [{ mode: "fixed", airport: "JFK", date: "2026-12-13" }] });
  assert.deepEqual(itineraries[0].legs.map((l) => [l.from, l.to, l.date]),
    [["MCO", "JFK", "2026-12-10"], ["JFK", "LHR", "2026-12-13"]]);
});

test("every leg has a cost and alternates are compared", () => {
  const { itineraries } = L.buildItineraries({ ...base, depAirports: ["MCO", "TPA"], arrAirports: ["LHR", "LGW"], stops: [] });
  assert.equal(itineraries.length, 4);
  for (const it of itineraries) for (const l of it.legs) assert.ok(l.cost > 0);
  const costs = itineraries.map((i) => i.totalCost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
});

test("estimateCost scales with cabin and passenger types", () => {
  const one = L.estimateCost(map, "MCO", "LHR", "economy", pax1);
  assert.ok(Math.abs(L.estimateCost(map, "MCO", "LHR", "economy", { adults: 2, children: 0, infants: 0 }) - one * 2) <= 1);
  assert.ok(L.estimateCost(map, "MCO", "LHR", "business", pax1) > one * 3);
  const fam = L.estimateCost(map, "MCO", "LHR", "economy", { adults: 2, children: 1, infants: 1 });
  assert.ok(Math.abs(fam - one * 2.85) <= 2);
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
  const pax = { adults: 2, children: 1, infants: 1 };
  const links = Object.fromEntries(L.airlineLinks(map, "JFK", "LHR", "2026-12-10", "business", pax).map((l) => [l.key, l.url]));
  assert.match(links.british, /cabin=C&ad=2&yf=0&ch=1&inf=1/);
  assert.match(links.jetblue, /adults=2&children=1&infants=1/);
  const gf = decodeURIComponent(L.googleFlightsUrl("JFK", "LHR", "2026-12-10", "business", pax, "EUR"));
  assert.match(gf, /business class for 2 adults, 1 child, 1 infant/);
  assert.match(gf, /curr=EUR/);
});

// --- Sharing & export --------------------------------------------------------
test("state round-trips through the URL and rejects junk", () => {
  const s = { ...L.DEFAULT_STATE, origin: "MCO", destination: "London", depAlts: ["TPA"], arrAlts: [], depart: "2026-12-10", end: "2026-12-20",
    trip: "oneway", adults: 2, children: 1, infants: 1, cabin: "business", currency: "GBP",
    stops: [{ mode: "fixed", airport: "JFK", date: "2026-12-12", country: "any" }, { mode: "suggest", airport: "", date: "", country: "different" }] };
  assert.deepEqual(L.parseState(L.serializeState(s)), s);
  const junk = L.parseState("from=MCO&to=X&adults=99&cabin=<script>&cur=XXX&depart=tomorrow&stops=a:b;suggest:evil");
  assert.equal(junk.adults, 1); assert.equal(junk.cabin, "economy"); assert.equal(junk.currency, "USD"); assert.equal(junk.depart, "");
  assert.deepEqual(junk.stops.map((x) => [x.mode, x.airport, x.country]), [["fixed", "", "any"], ["suggest", "", "any"]]);
  assert.equal(L.parseState(""), null);
});

test("text and calendar exports include every leg", () => {
  const { itineraries: [it] } = L.buildItineraries({ ...base, roundTrip: true, depAirports: ["MCO"], arrAirports: ["LHR"], stops: [] });
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
