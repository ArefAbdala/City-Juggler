# Plan My Trip — Multi-Stop Itinerary Planner

A fully static trip planning tool. Build multi-stop itineraries, get stopover recommendations, and search flights on Google Flights and airline websites — all client-side, no backend required.

**Live:** [plan-my-trip.pages.dev](https://plan-my-trip.pages.dev)

![Screenshot](screenshot.png)

## Features

- **Round trip or one way**: Round trips add a flight home on the return date; one-way trips fly the last leg on the "Arrive by" date
- **Multi-stop trips**: Up to 4 city stops between departure and arrival, each either an airport you choose (with an optional "leave on" date) or "Suggest for me"
- **Stop suggestions**: Recommends hub cities (from 110 hubs) with the least detour between the neighbouring points of your route. On-route hubs (≤30% detour) are preferred; the allowed detour widens (60%, 100%, 200%) only when needed to find enough matches. Several suggested stops get distinct cities, ordered so the route never doubles back. If none fits (e.g. very short trips), you're told why
- **No repeated stopovers across itineraries**: every itinerary in a search gets its own suggested stop cities — a city shown as a stop in one result (counting all its airports, e.g. NRT/HND) never appears as a suggested stop in another. Fresh stops never widen the detour beyond what the best choices needed, so long multi-stop trips may show fewer results rather than far-off stopovers
- **Places to avoid**: add up to 10 cities, airports or whole countries (autocomplete, or type e.g. "Paris", "LHR", "Germany", "UK"). Choosing an airport avoids its whole city. Avoided places are never suggested as stops, nearby airports or flexible-date alternatives, and you're warned if your own route uses one. Saved in the shareable link. Connections inside a single flight are chosen by the airline, so check them when booking
- **Country & continent preference** for suggested stops: same/different/any country, and a preferred continent (North America & Caribbean, South America, Europe, Asia & Middle East, Africa, Oceania). Not shown for "I know where" stops
- **Search by city, airport name or code**: "London", "Heathrow" and "LHR" all work; ties go to major hubs
- **Alternate airports**: 1–3 alternates for departure and arrival — every viable combination is compared
- **Multiple itinerary suggestions**: Always at least 8 (up to 12) variants, sorted by estimated cost. Built from alternate airports and hub choices; if that gives fewer than 8, nearby departure/arrival airports and flexible dates (whole trip a few days earlier/later, never in the past) are added and labelled
- **Travellers & currency**: Adults, children and lap infants; cabin class; prices shown in USD, EUR, GBP, CAD, AUD, MXN, JPY, INR or AED (approximate fixed rates)
- **Booking links**: Each flight links to Google Flights (with passengers, cabin and currency) plus the airlines likely to fly that route, most relevant first. Links pass passenger counts and cabin where the airline's URL supports it
- **Share & save**: The search is kept in the URL — copy the link to share or bookmark it; opening it re-runs the search. Your last search is remembered in the browser
- **Export**: Copy an itinerary as text, or download it as a calendar file (.ics)
- **Phone friendly**: Mobile layout with 44px tap targets and no zoom-on-focus
- **Accessible**: Keyboard-operable controls, ARIA combobox autocomplete, labelled buttons, errors announced to screen readers
- **Light/dark theme**: Follows system preference

## How it works

Everything runs in the browser:

1. The user fills in the form; airport text is resolved to IATA codes using `airports.json`
2. Input is validated (unknown airports, dates in the past or out of order, traveller limits)
3. For "Suggest for me" stops, hubs from `hub_cities.json` are filtered by country/continent preference and the avoid list, and ranked by detour from the surrounding waypoints
4. Variants are built from alternate airport combinations, each taking the best hubs whose city hasn't been used by an earlier itinerary (topped up with nearby airports / flexible dates to reach 8); flight dates are scheduled from fixed stop dates and spread evenly in between
5. Each leg gets a distance-based cost estimate and booking links

No backend, no API keys, no scraping.

## Development

No build step. Serve the folder with any static server (ES modules and `fetch` need http, not `file://`):

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Tests use Node's built-in test runner (Node 18+), no dependencies:

```sh
npm test              # unit tests for js/lib.js
npm run check-links   # pings each airline deep link; run occasionally, needs internet
```

Airline sites often block automated requests or change their URL formats. `check-links` flags links that look broken; confirm them in a browser and update the builder in `js/lib.js` (`AIRLINES`).

## Deployment

This is a static site. Deploy to any static host:

**Cloudflare Pages:**
- Connect the GitHub repo
- Build command: (none)
- Build output directory: `/` (root)
- Deploy

**Or any static host:** Just serve the root directory.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `styles.css` | All styles, including the mobile layout |
| `js/lib.js` | Pure logic (no DOM): airport search, scheduling, hub suggestions, cost estimates, booking links, URL state, text/ICS export |
| `js/app.js` | UI: form, autocomplete, rendering, sharing, local storage |
| `airports.json` | 524 airports with IATA codes, names, cities, countries, lat/lon |
| `hub_cities.json` | 110 major hub airports with region tags, used for stop suggestions |
| `tests/lib.test.js` | Unit tests (`npm test`) |
| `scripts/check-links.js` | Airline deep-link checker (`npm run check-links`) |
| `screenshot.png` | UI screenshot |

## Notes

- **Cost estimates are approximate**: distance × cabin multiplier × travellers (children 75%, lap infants 10%) with a small day-of-week adjustment (midweek/Saturday slightly cheaper), converted with fixed exchange rates. Open the booking links for real prices.
- **Each leg is booked separately**: the itinerary is a plan for self-transfer trips.
- **Airline deep links are best-effort**: they can break when airlines redesign their sites — see `npm run check-links`.
