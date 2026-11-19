# Plan My Trip — Multi-Stop Itinerary Planner

A fully static trip planning tool. Build multi-stop itineraries, get stopover recommendations, and search flights on Google Flights and airline websites — all client-side, no backend required.

**Live:** [plan-my-trip.pages.dev](https://plan-my-trip.pages.dev)

## Features

- **Multi-stop trips**: Add up to 4 intermediate stops between departure and arrival
- **Alternate airports**: Specify 1–3 alternate departure/arrival airports — the tool generates search links for all combinations
- **Stop suggestions**: Toggle "Suggest for me" on any stop — the tool recommends hub cities based on geographic routing efficiency (least detour from the direct route)
- **Google Flights links**: Each leg gets a direct Google Flights search link
- **Airline booking links**: Per-leg direct links to 17 airlines (Delta, United, American, JetBlue, Southwest, Alaska, Frontier, British Airways, Lufthansa, Air France, KLM, Emirates, Turkish Airlines, Qatar Airways, Singapore Airlines, Cathay Pacific, Air Canada)
- **Smart airline selection**: Shows relevant airlines based on route region (US domestic, transatlantic, etc.)
- **Airport autocomplete**: Search 524 airports by code, city, or name
- **Light/dark theme**: Follows system preference

## How it works

Everything runs in the browser:

1. User fills in the form: origin, destination, dates, intermediate stops
2. For "Suggest for me" stops: the app filters 45 major hub airports by geographic position (haversine distance, max 30% detour) and ranks by routing efficiency
3. The app builds the full itinerary with one leg per segment
4. Each leg shows clickable links to Google Flights and relevant airlines

No backend, no API keys, no scraping. Just a route planner with booking links.

## Deployment

This is a static site. Deploy to any static host:

**Cloudflare Pages:**
- Connect the GitHub repo
- Build command: (none)
- Build output directory: `/` (root)
- Deploy

**Or any static host:** Just serve the root directory. No build step needed.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app: form, itinerary logic, hub suggestions, booking links, CSS, all in one file |
| `airports.json` | 524 airports with IATA codes, names, cities, countries, lat/lon. Powers autocomplete + geographic filtering |
| `hub_cities.json` | 45 major hub airports with region tags. Used for stop suggestions |
| `screenshot.png` | UI screenshot |
| `PROJECT.md` | This file |

## Notes

- **No prices shown**: This is a route planner, not a fare aggregator. Click the links to see live prices on Google Flights or airline sites.
- **Geographic hub filtering**: Uses haversine distance to avoid nonsensical suggestions. Hubs must be within 30% extra distance of the direct route.
- **Each leg booked separately**: The itinerary is a plan for self-transfer trips. Each leg links to its own flight search.
