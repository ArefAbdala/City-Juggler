# Plan My Trip — Multi-Stop Itinerary Planner

A trip planning tool backed by [fast-flights](https://github.com/AWeirdDev/flights), a free library that scrapes Google Flights. Supports single flights, multi-leg itineraries with intermediate stops, alternate airports, and AI-powered stopover suggestions.

## Run it

**Double-click `start.bat`** on Windows — it handles everything (Python check, venv, deps, browser).

Or run manually:

```bash
cd Plan-My-Trip
python -m venv .venv && .venv\Scripts\activate   # Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://127.0.0.1:8000

### Demo mode (no network calls)

```bash
start.bat demo
```

Or manually: `set FLIGHTS_DEMO=1` then `uvicorn app:app`

## Features

### Simple Search
- One-way or round-trip between two airports
- Filter by cabin class, max stops, max price, number of passengers
- Results with airline booking links, CO2 info, expandable leg details

### Itinerary Builder (new)
- **Multi-stop trips**: Add up to 4 intermediate stops between departure and arrival
- **Alternate airports**: Specify 1–3 alternate departure/arrival airports — the tool finds the cheapest combination
- **Stop suggestions**: Toggle "Suggest for me" on any stop — the tool queries ~40 major hub airports, filters geographically, and ranks by price (50%), flight time (30%), and routing efficiency (20%)
- **Per-leg booking links**: Each leg of the itinerary gets its own airline booking links
- **Automatic date distribution**: If you don't specify dates for stops, they're distributed evenly across the trip

### How it decides
- With 0 stops and no alternates → hits `POST /api/search` (simple search, same as before)
- With stops or alternates → hits `POST /api/itinerary` (multi-leg search)
- For "Suggest for me" stops → queries origin→hub and hub→destination for each candidate hub, scores and ranks results

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /` | GET | Serves the UI |
| `GET /api/airports` | GET | Returns airport data (524 airports) for autocomplete |
| `POST /api/search` | POST | Simple point-to-point flight search |
| `POST /api/itinerary` | POST | Multi-leg itinerary search with stops and alternates |

### `POST /api/itinerary` request

```json
{
  "departure_airports": ["MCO", "SFB"],
  "arrival_airports": ["JFK", "EWR", "LGA"],
  "depart_date": "2025-01-15",
  "arrive_date": "2025-01-22",
  "stops": [
    {"mode": "fixed", "airport": "ATL", "date": "2025-01-18"},
    {"mode": "suggest", "airport": null, "date": null}
  ],
  "seat": "economy",
  "adults": 1,
  "children": 0,
  "max_price": null,
  "currency": "USD"
}
```

## How it works

```
Browser (static/index.html)
   │  POST /api/search  — simple search
   │  POST /api/itinerary — multi-leg with stops/alternates
   ▼
FastAPI (app.py) ── validates input ── 15-min in-memory cache
   │  fast_flights.create_query(...) → get_flights(...)
   ▼
Google Flights (scraped HTML) → parsed → JSON → rendered results
```

## Files

| File | Purpose |
|---|---|
| `app.py` | FastAPI backend. `POST /api/search` (simple), `POST /api/itinerary` (multi-leg), `GET /api/airports`. Hub loading, geographic filtering, suggestion scoring. |
| `static/index.html` | Single-file UI: itinerary form with alternates/stops, autocomplete, result cards, sorting, booking links, light/dark themes. |
| `static/airports.json` | 524 airports with IATA codes, names, cities, countries, lat/lon. Powers autocomplete and geographic filtering. |
| `static/hub_cities.json` | 45 major hub airports with region tags. Used for stop suggestions. |
| `requirements.txt` | `fast-flights==3.1.0`, `fastapi`, `uvicorn`. |
| `start.bat` | Windows launcher with Python check, venv, deps, port finding, browser opening. |
| `PROJECT.md` | This file. |

## Notes

- **fast-flights** is pinned to 3.1.0. Its API changed between major versions.
- **Rate limits**: Each itinerary search may issue 5–20 Google Flights queries. The 15-min cache mitigates repeated searches. Suggestion mode is heaviest (~10–15 queries).
- **Price = sum of legs**: Each leg is priced independently. Total itinerary cost = sum of all legs. This is accurate for separate bookings.
- **Geographic hub filtering**: Uses haversine distance to avoid nonsensical suggestions (e.g., routing NYC→LA through London). Hubs must be within 30% extra distance of the direct route.
- **Reliability**: This is an unofficial scraper. Google can change its page or rate-limit. The app shows the error and keeps working.
