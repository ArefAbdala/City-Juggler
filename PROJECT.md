# Plan My Trip — Multi-Stop Itinerary Planner

A fully static trip planning tool. Build multi-stop itineraries, get stopover recommendations, and search flights on Google Flights and airline websites — all client-side, no backend required.

**Live:** [plan-my-trip.pages.dev](https://plan-my-trip.pages.dev)

## Features

- **Multi-stop trips**: Add up to 4 intermediate stops between departure and arrival
- **Multiple itinerary suggestions**: Always shows at least 8 (up to 12) itinerary variants, sorted by estimated cost. Built from alternate airports and hub suggestions; if those give fewer than 8, the planner adds nearby departure/arrival airports and flexible-date options (whole trip shifted a few days earlier/later)
- **Cost estimates**: Each leg shows an approximate fare based on distance, cabin class, and passenger count
- **Alternate airports**: Specify 1–3 alternate departure/arrival airports — the tool generates itineraries for all viable combinations
- **Stop suggestions**: Toggle "Suggest for me" on any stop — the tool recommends hub cities based on geographic routing efficiency (least detour from the direct route)
- **Country & continent preference**: For "Suggest for me" stops, filter suggestions to same/different/any country and to a preferred continent (North America & Caribbean, South America, Europe, Asia & Middle East, Africa, Oceania). Not shown for "I know where" stops
- **Google Flights links**: Each leg gets a direct Google Flights search link
- **Airline booking links**: Per-leg direct links to 17 airlines (Delta, United, American, JetBlue, Southwest, Alaska, Frontier, British Airways, Lufthansa, Air France, KLM, Emirates, Turkish Airlines, Qatar Airways, Singapore Airlines, Cathay Pacific, Air Canada)
- **Smart airline selection**: Shows relevant airlines based on route region (US domestic, transatlantic, etc.)
- **Airport autocomplete**: Search 524 airports by code, city, or name
- **Light/dark theme**: Follows system preference

## How it works

Everything runs in the browser:

1. User fills in the form: origin, destination, dates, intermediate stops
2. For "Suggest for me" stops: the app filters 110 major hub airports by country/continent preference and ranks them by routing efficiency (haversine detour from the previous stop to the next fixed point). On-route hubs (≤30% detour) are preferred; the allowed detour widens only when needed to find enough options
3. The app generates multiple itinerary variants from alternate airport combos and hub suggestions
4. Each variant shows estimated cost per leg (distance-based) and total trip cost
5. Each leg shows clickable links to Google Flights and relevant airlines

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
| `hub_cities.json` | 110 major hub airports with region tags. Used for stop suggestions |
| `screenshot.png` | UI screenshot |
| `PROJECT.md` | This file |

## Notes

- **Cost estimates are approximate**: Based on distance × cabin class × passengers, with a small day-of-week adjustment (midweek/Saturday slightly cheaper). Click the booking links for real-time prices.
- **Geographic hub filtering**: Uses haversine distance to avoid nonsensical suggestions. Hubs within 30% extra distance of the route are preferred; larger detours are only used when a continent/country preference requires it.
- **Each leg booked separately**: The itinerary is a plan for self-transfer trips. Each leg links to its own flight search.
