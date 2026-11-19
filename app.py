"""Flight Finder — a small FastAPI backend around the fast-flights Google Flights scraper.

Run:  uvicorn app:app --reload        (then open http://127.0.0.1:8000)
Demo: FLIGHTS_DEMO=1 uvicorn app:app  (sample data, no network calls)
"""

from __future__ import annotations

import json
import math
import os
import time
from datetime import date, timedelta
from itertools import product
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from fast_flights import FlightQuery, Passengers, create_query, get_flights
from fast_flights.exceptions import FlightsNotFound

DEMO = os.getenv("FLIGHTS_DEMO") == "1"
CACHE_TTL_S = 15 * 60
_cache: dict[str, tuple[float, dict]] = {}

app = FastAPI(title="Flight Finder")
STATIC = Path(__file__).parent / "static"

# ---------------------------------------------------------------------------
# Airport data (loaded once at startup)
# ---------------------------------------------------------------------------
_airports: list[dict] = []
_airport_coords: dict[str, tuple[float, float]] = {}  # IATA -> (lat, lon)
_hub_cities: list[dict] = []


@app.on_event("startup")
def _load_airport_data():
    global _airports, _airport_coords, _hub_cities
    airports_path = STATIC / "airports.json"
    hubs_path = STATIC / "hub_cities.json"
    if airports_path.exists():
        _airports = json.loads(airports_path.read_text(encoding="utf-8"))
        _airport_coords = {a["iata"]: (a["lat"], a["lon"]) for a in _airports if a.get("lat") and a.get("lon")}
    if hubs_path.exists():
        _hub_cities = json.loads(hubs_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Shared models + helpers
# ---------------------------------------------------------------------------

def _upper_iata(v: str) -> str:
    if not v.isalpha() or len(v) != 3:
        raise ValueError("Use a 3-letter IATA airport code, e.g. MCO")
    return v.upper()


class SearchRequest(BaseModel):
    origin: str = Field(min_length=3, max_length=3)
    destination: str = Field(min_length=3, max_length=3)
    depart_date: date
    return_date: date | None = None
    trip: Literal["one-way", "round-trip"] = "one-way"
    seat: Literal["economy", "premium-economy", "business", "first"] = "economy"
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=8)
    max_stops: int | None = Field(None, ge=0, le=2)
    max_price: int | None = Field(None, gt=0)
    currency: str = "USD"

    @field_validator("origin", "destination")
    @classmethod
    def upper_iata(cls, v: str) -> str:
        return _upper_iata(v)

    @model_validator(mode="after")
    def check_trip(self) -> "SearchRequest":
        if self.depart_date < date.today():
            raise ValueError("Departure date is in the past")
        if self.trip == "round-trip":
            if not self.return_date:
                raise ValueError("Round trip needs a return date")
            if self.return_date < self.depart_date:
                raise ValueError("Return date is before departure")
        if self.adults + self.children > 9:
            raise ValueError("Max 9 passengers")
        return self


class Stop(BaseModel):
    mode: Literal["fixed", "suggest"]
    airport: str | None = None
    date: str | None = None  # ISO date string

    @field_validator("airport")
    @classmethod
    def upper_airport(cls, v: str | None) -> str | None:
        if v is not None:
            return _upper_iata(v)
        return v


class ItineraryRequest(BaseModel):
    departure_airports: list[str] = Field(min_length=1, max_length=4)
    arrival_airports: list[str] = Field(min_length=1, max_length=4)
    depart_date: date
    arrive_date: date
    stops: list[Stop] = Field(default_factory=list, max_length=4)
    seat: Literal["economy", "premium-economy", "business", "first"] = "economy"
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=8)
    max_price: int | None = Field(None, gt=0)
    currency: str = "USD"

    @field_validator("departure_airports", "arrival_airports")
    @classmethod
    def upper_all(cls, v: list[str]) -> list[str]:
        return [_upper_iata(code) for code in v]

    @model_validator(mode="after")
    def check_dates(self) -> "ItineraryRequest":
        if self.depart_date < date.today():
            raise ValueError("Departure date is in the past")
        if self.arrive_date < self.depart_date:
            raise ValueError("Arrival date is before departure")
        if self.adults + self.children > 9:
            raise ValueError("Max 9 passengers")
        return self


# ---------------------------------------------------------------------------
# Serialization helpers (unchanged)
# ---------------------------------------------------------------------------

def _fmt_dt(dt) -> str:
    y, m, d = dt.date
    hh, mm = dt.time
    return f"{y:04d}-{m:02d}-{d:02d}T{hh:02d}:{mm:02d}"


def _total_minutes(legs: list[dict]) -> int:
    from datetime import datetime as dt
    total = sum(l["duration_min"] for l in legs)
    for a, b in zip(legs, legs[1:]):
        total += int((dt.fromisoformat(b["depart"]) - dt.fromisoformat(a["arrive"])).total_seconds() // 60)
    return total


def _serialize(results) -> list[dict]:
    out = []
    for r in results:
        per_leg_airlines = r.airlines if r.airlines else []
        legs = [
            {
                "from": {"code": s.from_airport.code, "name": s.from_airport.name},
                "to": {"code": s.to_airport.code, "name": s.to_airport.name},
                "depart": _fmt_dt(s.departure),
                "arrive": _fmt_dt(s.arrival),
                "duration_min": s.duration,
                "plane": s.plane_type,
                "airline": per_leg_airlines[i] if i < len(per_leg_airlines) else (per_leg_airlines[0] if per_leg_airlines else ""),
            }
            for i, s in enumerate(r.flights)
        ]
        out.append(
            {
                "price": r.price,
                "airlines": r.airlines,
                "stops": max(len(legs) - 1, 0),
                "total_duration_min": _total_minutes(legs),
                "legs": legs,
                "co2_kg": round(r.carbon.emission / 1000) if r.carbon else None,
                "co2_typical_kg": round(r.carbon.typical_on_route / 1000) if r.carbon else None,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Demo data generators
# ---------------------------------------------------------------------------

def _demo_results(req: SearchRequest) -> list[dict]:
    o, d, day = req.origin, req.destination, req.depart_date.isoformat()
    rows = [
        (189, ["Delta"], [(o, "ATL", "06:05", "07:40", 95), ("ATL", d, "08:55", "11:20", 145)]),
        (214, ["JetBlue"], [(o, d, "09:30", "12:45", 195)]),
        (156, ["Frontier"], [(o, d, "13:10", "16:30", 200)]),
        (262, ["American"], [(o, "CLT", "07:15", "08:55", 100), ("CLT", d, "10:05", "12:20", 135)]),
        (305, ["United"], [(o, d, "17:40", "20:50", 190)]),
    ]
    out = []
    for price, airlines, legs in rows:
        L = [
            {
                "from": {"code": a, "name": a},
                "to": {"code": b, "name": b},
                "depart": f"{day}T{t1}",
                "arrive": f"{day}T{t2}",
                "duration_min": dur,
                "plane": "Airbus A321",
                "airline": airlines[min(i, len(airlines) - 1)],
            }
            for i, (a, b, t1, t2, dur) in enumerate(legs)
        ]
        out.append(
            {
                "price": price * (req.adults + req.children),
                "airlines": airlines,
                "stops": len(L) - 1,
                "total_duration_min": _total_minutes(L),
                "legs": L,
                "co2_kg": 180 + 40 * (len(L) - 1),
                "co2_typical_kg": 200,
            }
        )
    return out


def _demo_leg_results(origin: str, destination: str, day: str, pax: int) -> list[dict]:
    """Generate demo results for a single leg (origin→destination on a date)."""
    base_prices = [120, 189, 245]
    airlines_list = [["Delta"], ["JetBlue"], ["United"]]
    times = [("07:00", "09:30", 150), ("11:15", "14:00", 165), ("16:30", "19:15", 165)]
    out = []
    for price, airlines, (t1, t2, dur) in zip(base_prices, airlines_list, times):
        L = [{
            "from": {"code": origin, "name": origin},
            "to": {"code": destination, "name": destination},
            "depart": f"{day}T{t1}",
            "arrive": f"{day}T{t2}",
            "duration_min": dur,
            "plane": "Boeing 737",
            "airline": airlines[0],
        }]
        out.append({
            "price": price * pax,
            "airlines": airlines,
            "stops": 0,
            "total_duration_min": dur,
            "legs": L,
            "co2_kg": 150,
            "co2_typical_kg": 200,
        })
    return out


# ---------------------------------------------------------------------------
# Flight query helper (single leg, with caching)
# ---------------------------------------------------------------------------

def _query_leg(origin: str, dest: str, day: str, seat: str, adults: int, children: int,
               currency: str, max_price: int | None = None) -> list[dict]:
    """Query Google Flights for a single one-way leg. Returns serialized results."""
    cache_key = f"leg:{origin}:{dest}:{day}:{seat}:{adults}:{children}:{currency}:{max_price}"
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]

    if DEMO:
        results = _demo_leg_results(origin, dest, day, adults + children)
    else:
        try:
            flights = [FlightQuery(date=day, from_airport=origin, to_airport=dest)]
            query = create_query(
                flights=flights,
                trip="one-way",
                seat=seat,
                passengers=Passengers(adults=adults, children=children),
                currency=currency,
                language="en-US",
                max_price=max_price,
            )
            results = _serialize(get_flights(query))
        except FlightsNotFound:
            results = []
        except Exception:
            results = []

    results.sort(key=lambda r: r["price"])
    _cache[cache_key] = (time.time(), results)
    return results


# ---------------------------------------------------------------------------
# Geographic helpers
# ---------------------------------------------------------------------------

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in km between two points on Earth."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _is_between(hub_code: str, orig_code: str, dest_code: str, margin: float = 0.3) -> bool:
    """Check if a hub is roughly between origin and destination (not causing major backtracking)."""
    orig = _airport_coords.get(orig_code)
    dest = _airport_coords.get(dest_code)
    hub = _airport_coords.get(hub_code)
    if not orig or not dest or not hub:
        return True  # if we can't check, include it

    direct = _haversine(*orig, *dest)
    if direct < 100:  # very short trip, skip hub suggestions
        return False
    via_hub = _haversine(*orig, *hub) + _haversine(*hub, *dest)
    # Allow up to margin% extra distance (e.g. 30% detour)
    return via_hub <= direct * (1 + margin)


# ---------------------------------------------------------------------------
# Itinerary search logic
# ---------------------------------------------------------------------------

def _search_fixed_itinerary(req: ItineraryRequest) -> list[dict]:
    """Build itineraries for fixed stops with alternate airports."""
    # Build waypoints: [departure_airports, stop1, stop2, ..., arrival_airports]
    waypoints: list[list[str]] = [req.departure_airports]
    n_stops = len([s for s in req.stops if s.mode == "fixed"])
    total_legs = n_stops + 1

    # Distribute dates across legs
    total_days = (req.arrive_date - req.depart_date).days
    dates: list[str] = []
    for i in range(total_legs):
        if i == 0:
            dates.append(req.depart_date.isoformat())
        else:
            # Check if the stop has a date
            stop = req.stops[i - 1] if i - 1 < len(req.stops) else None
            if stop and stop.date:
                dates.append(stop.date)
            else:
                # Distribute evenly
                day_offset = round(total_days * i / total_legs)
                dates.append((req.depart_date + timedelta(days=day_offset)).isoformat())

    for s in req.stops:
        if s.mode == "fixed" and s.airport:
            waypoints.append([s.airport])
    waypoints.append(req.arrival_airports)

    # Query each leg for all airport combinations, pick cheapest per leg
    leg_results: list[list[dict]] = []
    for i in range(len(waypoints) - 1):
        origins = waypoints[i]
        dests = waypoints[i + 1]
        day = dates[i]
        best_for_leg: list[dict] = []
        for o, d in product(origins, dests):
            results = _query_leg(o, d, day, req.seat, req.adults, req.children, req.currency, req.max_price)
            best_for_leg.extend(results[:3])  # top 3 per combo
        best_for_leg.sort(key=lambda r: r["price"])
        leg_results.append(best_for_leg[:5])  # keep top 5 per leg

    # Combine legs into full itineraries (cheapest from each leg)
    itineraries = []
    if not leg_results or any(not lr for lr in leg_results):
        return []

    # Generate combinations: take top options from each leg
    max_combos = min(10, math.prod(min(len(lr), 3) for lr in leg_results))
    # Simple approach: pair cheapest options
    for combo_idx in range(min(max_combos, 5)):
        total_price = 0
        all_legs = []
        all_airlines = []
        total_dur = 0
        valid = True

        for leg_idx, lr in enumerate(leg_results):
            pick_idx = min(combo_idx, len(lr) - 1) if leg_idx == 0 else 0
            if combo_idx > 0 and leg_idx > 0:
                pick_idx = min(combo_idx % max(len(lr), 1), len(lr) - 1)
            option = lr[pick_idx]
            total_price += option["price"]
            all_legs.extend(option["legs"])
            all_airlines.extend(option["airlines"])
            total_dur += option["total_duration_min"]

        itineraries.append({
            "total_price": total_price,
            "currency": req.currency,
            "legs": all_legs,
            "leg_count": len(waypoints) - 1,
            "airlines": list(dict.fromkeys(all_airlines)),  # unique, ordered
            "total_duration_min": total_dur,
            "stops": [s.airport for s in req.stops if s.mode == "fixed"],
            "suggested_stops": [],
        })

    # Deduplicate by leg composition
    seen = set()
    unique = []
    for it in itineraries:
        key = tuple((l["from"]["code"], l["to"]["code"], l["depart"]) for l in it["legs"])
        if key not in seen:
            seen.add(key)
            unique.append(it)
    unique.sort(key=lambda x: x["total_price"])
    return unique[:10]


def _search_suggested_stops(req: ItineraryRequest) -> list[dict]:
    """Find best hub cities for 'suggest' stops."""
    # Determine which stops need suggestions
    suggest_indices = [i for i, s in enumerate(req.stops) if s.mode == "suggest"]
    if not suggest_indices:
        return []

    # For simplicity, handle single suggest stop (most common case)
    # For multiple suggest stops, we'd need combinatorial hub search
    orig = req.departure_airports[0]
    dest = req.arrival_airports[0]

    # Filter hubs geographically
    candidate_hubs = [h for h in _hub_cities
                      if h["code"] != orig and h["code"] != dest
                      and h["code"] not in req.departure_airports
                      and h["code"] not in req.arrival_airports
                      and _is_between(h["code"], orig, dest)]

    if not candidate_hubs:
        candidate_hubs = _hub_cities[:10]  # fallback to top hubs

    # Limit to reasonable number of candidates
    candidate_hubs = candidate_hubs[:8]

    day1 = req.depart_date.isoformat()
    # Midpoint date for the stopover
    mid_days = (req.arrive_date - req.depart_date).days // 2
    day2 = (req.depart_date + timedelta(days=max(mid_days, 1))).isoformat()

    suggestions = []
    for hub in candidate_hubs:
        # Query origin → hub
        leg1_results = _query_leg(orig, hub["code"], day1, req.seat,
                                  req.adults, req.children, req.currency)
        # Query hub → destination
        leg2_results = _query_leg(hub["code"], dest, day2, req.seat,
                                  req.adults, req.children, req.currency)

        if not leg1_results or not leg2_results:
            continue

        best1 = leg1_results[0]
        best2 = leg2_results[0]
        total_price = best1["price"] + best2["price"]
        total_dur = best1["total_duration_min"] + best2["total_duration_min"]

        # Score: lower is better (50% price, 30% time, 20% routing efficiency)
        direct_dist = _haversine(*_airport_coords.get(orig, (0, 0)), *_airport_coords.get(dest, (0, 0))) or 1
        via_dist = (_haversine(*_airport_coords.get(orig, (0, 0)), *_airport_coords.get(hub["code"], (0, 0)))
                    + _haversine(*_airport_coords.get(hub["code"], (0, 0)), *_airport_coords.get(dest, (0, 0))))
        routing_ratio = via_dist / direct_dist if direct_dist > 0 else 2

        suggestions.append({
            "hub": hub,
            "total_price": total_price,
            "total_duration_min": total_dur,
            "routing_ratio": routing_ratio,
            "leg1": best1,
            "leg2": best2,
            "day1": day1,
            "day2": day2,
        })

    # Normalize and score
    if suggestions:
        min_price = min(s["total_price"] for s in suggestions) or 1
        max_price = max(s["total_price"] for s in suggestions) or 1
        min_dur = min(s["total_duration_min"] for s in suggestions) or 1
        max_dur = max(s["total_duration_min"] for s in suggestions) or 1

        for s in suggestions:
            price_norm = (s["total_price"] - min_price) / (max_price - min_price) if max_price > min_price else 0
            dur_norm = (s["total_duration_min"] - min_dur) / (max_dur - min_dur) if max_dur > min_dur else 0
            route_norm = max(0, min(1, (s["routing_ratio"] - 1) / 0.5))  # 0 at ratio=1, 1 at ratio=1.5
            s["score"] = 0.5 * price_norm + 0.3 * dur_norm + 0.2 * route_norm

        suggestions.sort(key=lambda s: s["score"])

    # Build itinerary objects from top suggestions
    itineraries = []
    for s in suggestions[:5]:
        all_legs = s["leg1"]["legs"] + s["leg2"]["legs"]
        all_airlines = list(dict.fromkeys(s["leg1"]["airlines"] + s["leg2"]["airlines"]))
        itineraries.append({
            "total_price": s["total_price"],
            "currency": req.currency,
            "legs": all_legs,
            "leg_count": 2,
            "airlines": all_airlines,
            "total_duration_min": s["total_duration_min"],
            "stops": [],
            "suggested_stops": [{
                "code": s["hub"]["code"],
                "name": s["hub"]["name"],
                "leg1_price": s["leg1"]["price"],
                "leg2_price": s["leg2"]["price"],
            }],
        })

    return itineraries


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/airports")
def get_airports():
    """Serve airport data for UI autocomplete."""
    return JSONResponse(content=_airports)


@app.post("/api/search")
def search(req: SearchRequest) -> dict:
    key = req.model_dump_json()
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return {**hit[1], "cached": True}

    flights = [FlightQuery(date=req.depart_date.isoformat(), from_airport=req.origin, to_airport=req.destination)]
    if req.trip == "round-trip":
        flights.append(
            FlightQuery(date=req.return_date.isoformat(), from_airport=req.destination, to_airport=req.origin)
        )
    query = create_query(
        flights=flights,
        trip=req.trip,
        seat=req.seat,
        passengers=Passengers(adults=req.adults, children=req.children),
        currency=req.currency,
        language="en-US",
        max_stops=req.max_stops,
        max_price=req.max_price,
    )

    if DEMO:
        results = _demo_results(req)
    else:
        try:
            results = _serialize(get_flights(query))
        except FlightsNotFound:
            results = []
        except Exception as e:
            raise HTTPException(502, f"Google Flights lookup failed: {type(e).__name__}: {e}") from e

    if req.max_stops is not None:
        results = [r for r in results if r["stops"] <= req.max_stops]
    results.sort(key=lambda r: r["price"])

    payload = {
        "results": results,
        "currency": req.currency,
        "google_flights_url": query.url(),
        "demo": DEMO,
        "cached": False,
    }
    _cache[key] = (time.time(), payload)
    return payload


@app.post("/api/itinerary")
def itinerary_search(req: ItineraryRequest) -> dict:
    """Multi-leg itinerary search with alternate airports and stop suggestions."""
    cache_key = "itin:" + req.model_dump_json()
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return {**hit[1], "cached": True}

    has_suggest = any(s.mode == "suggest" for s in req.stops)
    has_fixed = any(s.mode == "fixed" for s in req.stops)

    itineraries: list[dict] = []

    if has_suggest:
        itineraries.extend(_search_suggested_stops(req))

    if has_fixed or not req.stops:
        fixed_req = req
        if has_suggest:
            # Filter to only fixed stops for the fixed search
            fixed_stops = [s for s in req.stops if s.mode == "fixed"]
            fixed_req = req.model_copy(update={"stops": fixed_stops})
        itineraries.extend(_search_fixed_itinerary(fixed_req))

    itineraries.sort(key=lambda x: x["total_price"])

    payload = {
        "itineraries": itineraries[:15],
        "currency": req.currency,
        "demo": DEMO,
        "cached": False,
    }
    _cache[cache_key] = (time.time(), payload)
    return payload


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
