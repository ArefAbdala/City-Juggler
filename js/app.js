import {
  todayISO, addDays, validateStopDates, indexAirports, searchAirports, resolveAirport, airportLabel,
  buildItineraries, googleFlightsUrl, airlineLinks, formatMoney, formatDate, CURRENCIES,
  serializeState, parseState, itineraryToText, itineraryToICS,
} from "./lib.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const extIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>`;
const STORAGE_KEY = "plan-my-trip:last-search";
const MAX_ALTS = 3, MAX_STOPS = 4, TOP_AIRLINES = 4;

let airports = [], airportMap = {}, hubs = [], hubSet = new Set(), dataReady = false;
let depAlts = [], arrAlts = [], stops = [];
let lastResults = null; // { itineraries, opts }

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
function showBanner(messages, kind = "err") {
  const list = [].concat(messages).filter(Boolean);
  $("banner").innerHTML = list.map((m) => `<div class="banner ${kind}" ${kind === "err" ? 'role="alert"' : ""}>${esc(m)}</div>`).join("");
}
const clearBanner = () => { $("banner").innerHTML = ""; };

// ---------------------------------------------------------------------------
// Static selects & dates
// ---------------------------------------------------------------------------
const fillSelect = (el, a, b, sel) => { el.innerHTML = Array.from({ length: b - a + 1 }, (_, i) => `<option${i + a === sel ? " selected" : ""}>${i + a}</option>`).join(""); };
fillSelect($("adults"), 1, 9, 1);
fillSelect($("children"), 0, 8, 0);
fillSelect($("infants"), 0, 1, 0);
$("currency").innerHTML = Object.keys(CURRENCIES).map((c) => `<option>${c}</option>`).join("");

function syncInfants() {
  const max = +$("adults").value, cur = Math.min(+$("infants").value, max);
  fillSelect($("infants"), 0, max, cur);
}
$("adults").addEventListener("change", syncInfants);

const today = todayISO();
$("depart").min = $("ret").min = today;
$("depart").value = addDays(today, 21);
$("ret").value = addDays(today, 28);
$("depart").addEventListener("change", () => {
  $("ret").min = $("depart").value || today;
  if ($("ret").value && $("ret").value < $("depart").value) $("ret").value = $("depart").value;
  document.querySelectorAll(".stop-date").forEach((i) => { i.min = $("depart").value; });
});

const tripType = () => document.querySelector('input[name="trip"]:checked').value;
const endUsed = () => tripType() === "round" || stops.length > 0;

function updateDateFields() {
  const round = tripType() === "round";
  $("end-label").textContent = round ? "Return" : "Arrive by";
  $("end-field").hidden = !endUsed();
  $("date-hint").textContent = round
    ? "You'll fly home from your destination on the return date."
    : stops.length ? "Your last flight (from your final stop to your destination) is on the “Arrive by” date." : "";
}
document.querySelectorAll('input[name="trip"]').forEach((r) => r.addEventListener("change", updateDateFields));

$("swap").addEventListener("click", () => {
  const o = $("origin").value; $("origin").value = $("destination").value; $("destination").value = o;
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const dataLoaded = Promise.all([
  fetch("airports.json").then((r) => { if (!r.ok) throw new Error(`airports.json: HTTP ${r.status}`); return r.json(); }),
  fetch("hub_cities.json").then((r) => { if (!r.ok) throw new Error(`hub_cities.json: HTTP ${r.status}`); return r.json(); }),
]).then(([ap, hb]) => {
  airports = ap; airportMap = indexAirports(ap); hubs = hb; hubSet = new Set(hb.map((h) => h.code)); dataReady = true;
  $("go").disabled = false; $("go").textContent = "Plan Trip";
}).catch((e) => {
  console.error("Failed to load airport data:", e);
  $("go").textContent = "Unavailable";
  showBanner("Couldn't load airport data, so trips can't be planned right now. Check your connection and reload the page.");
});

// ---------------------------------------------------------------------------
// Autocomplete (ARIA combobox)
// ---------------------------------------------------------------------------
function setupAutocomplete(input, list, onPick) {
  let active = -1, items = [];
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  list.setAttribute("role", "listbox");

  const close = () => { list.classList.remove("show"); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const render = () => {
    if (!items.length) return close();
    list.innerHTML = items.map((a, i) =>
      `<div class="ac-item${i === active ? " active" : ""}" role="option" id="${list.id}-opt-${i}" aria-selected="${i === active}" data-code="${a.iata}">
        <span class="ac-code">${esc(a.iata)}</span>
        <span class="ac-detail">${esc(a.city)}, ${esc(a.country)} — ${esc(a.name)}</span>
      </div>`).join("");
    list.classList.add("show");
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const pick = (code) => { input.value = code; close(); onPick && onPick(code); };

  input.addEventListener("input", () => { active = -1; items = searchAirports(airports, input.value, 8, hubSet); render(); onPick && onPick(input.value); });
  input.addEventListener("keydown", (e) => {
    if (!list.classList.contains("show")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active].iata); }
    else if (e.key === "Escape") { close(); }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus so blur doesn't close first
  list.addEventListener("click", (e) => { const it = e.target.closest(".ac-item"); if (it) pick(it.dataset.code); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("focus", () => { if (input.value) { items = searchAirports(airports, input.value, 8, hubSet); render(); } });
}
setupAutocomplete($("origin"), $("origin-ac"));
setupAutocomplete($("destination"), $("destination-ac"));

// ---------------------------------------------------------------------------
// Alternate airports
// ---------------------------------------------------------------------------
function renderAlts(prefix) {
  const container = $(`${prefix}-alts`), arr = prefix === "dep" ? depAlts : arrAlts;
  const kind = prefix === "dep" ? "departure" : "arrival";
  container.innerHTML = arr.map((code, i) => `
    <div class="alt-row">
      <div class="field ac-wrap">
        <label for="${prefix}-alt-${i}">Alt ${kind} ${i + 1}</label>
        <input id="${prefix}-alt-${i}" class="code" value="${esc(code)}" data-idx="${i}" placeholder="City or code" autocapitalize="words" spellcheck="false">
        <div class="ac-list" id="${prefix}-alt-ac-${i}"></div>
      </div>
      <button type="button" class="remove-alt" data-idx="${i}" aria-label="Remove alternate ${kind} airport ${i + 1}">×</button>
    </div>`).join("");
  container.querySelectorAll("input").forEach((inp) => {
    const i = +inp.dataset.idx;
    setupAutocomplete(inp, $(`${prefix}-alt-ac-${i}`), (v) => { arr[i] = v; });
  });
  container.querySelectorAll(".remove-alt").forEach((btn) => btn.addEventListener("click", () => {
    arr.splice(+btn.dataset.idx, 1); renderAlts(prefix);
    $(`add-${prefix}-alt`).focus();
  }));
  $(`add-${prefix}-alt`).hidden = arr.length >= MAX_ALTS;
}
$("add-dep-alt").addEventListener("click", () => { depAlts.push(""); renderAlts("dep"); $(`dep-alt-${depAlts.length - 1}`).focus(); });
$("add-arr-alt").addEventListener("click", () => { arrAlts.push(""); renderAlts("arr"); $(`arr-alt-${arrAlts.length - 1}`).focus(); });

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------
function seg(name, label, options, current, attr) {
  return `<div class="seg" role="radiogroup" aria-label="${label}">${options.map(([v, t]) =>
    `<label><input type="radio" name="${name}" value="${v}" ${current === v ? "checked" : ""} ${attr}><span>${t}</span></label>`).join("")}</div>`;
}

function renderStops() {
  const container = $("stops-section");
  container.innerHTML = stops.map((s, i) => `
    <div class="stop-row" data-idx="${i}">
      <span class="stop-num">${i + 1}</span>
      ${seg(`stop-${i}-mode`, `Stop ${i + 1}: how to choose`, [["fixed", "I know where"], ["suggest", "Suggest for me"]], s.mode, `data-idx="${i}" data-mode`)}
      ${s.mode === "suggest" ? seg(`stop-${i}-country`, `Stop ${i + 1}: country`, [["any", "Any country"], ["same", "Same country"], ["different", "Different country"]], s.country, `data-idx="${i}" data-country`) : ""}
      <div class="stop-fields">
        ${s.mode === "fixed" ? `
          <div class="field ac-wrap">
            <label for="stop-airport-${i}">Airport</label>
            <input id="stop-airport-${i}" class="code stop-airport" value="${esc(s.airport || "")}" placeholder="City or code" data-idx="${i}" autocapitalize="words" spellcheck="false">
            <div class="ac-list" id="stop-ac-${i}"></div>
          </div>
          <div class="field">
            <label for="stop-date-${i}">Leave on <span class="label-note">optional</span></label>
            <input id="stop-date-${i}" type="date" class="stop-date" value="${esc(s.date || "")}" data-idx="${i}" min="${$("depart").value}">
          </div>
        ` : `<div class="stop-suggest-label">We'll recommend stopover cities along your route that match your country preference.</div>`}
      </div>
      <button type="button" class="remove-stop" data-idx="${i}" aria-label="Remove stop ${i + 1}">×</button>
    </div>`).join("");

  container.querySelectorAll("[data-mode]").forEach((r) => r.addEventListener("change", () => {
    stops[+r.dataset.idx].mode = r.value; renderStops();
    container.querySelector(`input[name="stop-${r.dataset.idx}-mode"]:checked`).focus();
  }));
  container.querySelectorAll("[data-country]").forEach((r) => r.addEventListener("change", () => { stops[+r.dataset.idx].country = r.value; }));
  container.querySelectorAll(".stop-airport").forEach((inp) => {
    const i = +inp.dataset.idx;
    setupAutocomplete(inp, $(`stop-ac-${i}`), (v) => { stops[i].airport = v; });
  });
  container.querySelectorAll(".stop-date").forEach((inp) => inp.addEventListener("change", () => { stops[+inp.dataset.idx].date = inp.value; }));
  container.querySelectorAll(".remove-stop").forEach((btn) => btn.addEventListener("click", () => {
    stops.splice(+btn.dataset.idx, 1); renderStops(); $("add-stop").focus();
  }));
  $("add-stop").hidden = stops.length >= MAX_STOPS;
  updateDateFields();
}
$("add-stop").addEventListener("click", () => {
  stops.push({ mode: "fixed", airport: "", date: "", country: "any" }); renderStops();
  $(`stop-airport-${stops.length - 1}`).focus();
});

// ---------------------------------------------------------------------------
// Form state <-> UI
// ---------------------------------------------------------------------------
function readState() {
  return {
    origin: $("origin").value.trim(), destination: $("destination").value.trim(),
    depAlts: depAlts.map((a) => a.trim()).filter(Boolean), arrAlts: arrAlts.map((a) => a.trim()).filter(Boolean),
    depart: $("depart").value, end: endUsed() ? $("ret").value : "", trip: tripType(),
    adults: +$("adults").value, children: +$("children").value, infants: +$("infants").value,
    cabin: $("seat").value, currency: $("currency").value,
    stops: stops.map((s) => ({ ...s })),
  };
}

function applyState(s) {
  $("origin").value = s.origin; $("destination").value = s.destination;
  depAlts = [...s.depAlts]; arrAlts = [...s.arrAlts]; renderAlts("dep"); renderAlts("arr");
  if (s.depart && s.depart >= today) $("depart").value = s.depart;
  if (s.end && s.end >= $("depart").value) $("ret").value = s.end;
  $("ret").min = $("depart").value;
  document.querySelector(`input[name="trip"][value="${s.trip}"]`).checked = true;
  $("adults").value = s.adults; syncInfants();
  $("children").value = s.children; $("infants").value = Math.min(s.infants, s.adults);
  $("seat").value = s.cabin; $("currency").value = s.currency;
  stops = s.stops.map((x) => ({ ...x, date: x.date && x.date >= $("depart").value ? x.date : "" }));
  renderStops();
}

const storage = {
  get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage unavailable */ } },
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
function plan() {
  if (!dataReady) return;
  const s = readState();
  const resolve = (v) => resolveAirport(airportMap, airports, v, hubSet);
  const errors = [];
  const need = (v, what) => {
    if (!v) { errors.push(`Please enter ${what}.`); return null; }
    const c = resolve(v);
    if (!c) errors.push(`Couldn't find an airport matching “${v}” (${what}). Try a city name or 3-letter code from the suggestions.`);
    return c;
  };

  const origin = need(s.origin, "a departure airport");
  const dest = need(s.destination, "an arrival airport");
  const depA = s.depAlts.map((v) => need(v, "an alternate departure airport"));
  const arrA = s.arrAlts.map((v) => need(v, "an alternate arrival airport"));
  const stopCodes = s.stops.map((st, i) => (st.mode === "fixed" ? need(st.airport, `stop ${i + 1}'s airport`) : null));

  if (!s.depart) errors.push("Please choose a departure date.");
  else if (s.depart < today) errors.push("Departure date can't be in the past.");
  if (endUsed()) {
    if (!s.end) errors.push(`Please choose ${s.trip === "round" ? "a return" : "an “arrive by”"} date.`);
    else if (s.depart && s.end < s.depart) errors.push(`${s.trip === "round" ? "Return" : "“Arrive by”"} date must be on or after the departure date.`);
  }
  if (origin && dest && origin === dest) errors.push("Departure and arrival airports must be different.");
  if (s.infants > s.adults) errors.push("Each infant on a lap needs an adult.");
  if (s.adults + s.children + s.infants > 9) errors.push("Up to 9 travellers can be searched at once.");
  const dateErr = s.depart && validateStopDates(s.depart, s.end, s.stops.map((st) => (st.mode === "fixed" ? st.date : "")), endUsed());
  if (dateErr) errors.push(dateErr);

  if (errors.length) { showBanner(errors); $("banner").scrollIntoView({ behavior: "smooth", block: "center" }); return; }

  // Show the resolved codes so the user sees what was matched.
  $("origin").value = origin; $("destination").value = dest;
  depAlts = depA; arrAlts = arrA; renderAlts("dep"); renderAlts("arr");
  stops.forEach((st, i) => { if (stopCodes[i]) st.airport = stopCodes[i]; });
  renderStops();

  const pax = { adults: s.adults, children: s.children, infants: s.infants };
  const opts = { cabin: s.cabin, pax, currency: s.currency };
  const { itineraries, warnings } = buildItineraries({
    map: airportMap, hubs,
    depAirports: [...new Set([origin, ...depA])], arrAirports: [...new Set([dest, ...arrA])],
    stops: s.stops.map((st, i) => ({ ...st, airport: stopCodes[i] })),
    depart: s.depart, end: s.end || s.depart, roundTrip: s.trip === "round", cabin: s.cabin, pax,
  });

  if (warnings.length) showBanner(warnings, "info"); else clearBanner();
  renderItineraries(itineraries, opts);

  const saved = readState();
  const query = serializeState(saved);
  storage.set(query);
  history.replaceState(null, "", `${location.pathname}?${query}`);

  const target = warnings.length ? $("banner") : $("results");
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  $("results").focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function renderItineraries(itineraries, opts) {
  lastResults = { itineraries, opts };
  if (!itineraries.length) {
    $("results").innerHTML = `<div class="empty">No itineraries found. Try adjusting your stops or airports.</div>`;
    return;
  }
  const { cabin, pax, currency } = opts;
  let html = `<div class="bar">
    <div class="meta">${itineraries.length} itinerar${itineraries.length === 1 ? "y" : "ies"} found · cheapest first</div>
    <button type="button" class="ghost-btn" data-action="share">Copy link to this search</button>
  </div>`;

  itineraries.forEach((itin, idx) => {
    const cheapest = idx === 0 && itineraries.length > 1;
    const routeStr = itin.codes.map((c) => airportLabel(airportMap, c)).join(" → ");
    const first = itin.legs[0].date, last = itin.legs[itin.legs.length - 1].date;
    html += `<article class="itin-card${cheapest ? " best-card" : ""}" aria-label="Itinerary ${idx + 1}">
      <div class="itin-header">
        <div>
          <h2 class="itin-route">${esc(routeStr)}${cheapest ? ' <span class="tag cheapest">Cheapest</span>' : ""}</h2>
          <div class="sub">${esc(formatDate(first))}${first !== last ? ` – ${esc(formatDate(last))}` : ""} · ${itin.legs.length} flight${itin.legs.length > 1 ? "s" : ""}</div>
        </div>
        <div class="itin-total-cost">~${esc(formatMoney(itin.totalCost, currency))}</div>
      </div>`;

    itin.legs.forEach((leg, i) => {
      const tag = leg.isReturn ? ` <span class="suggested-tag">— Return home</span>`
        : leg.suggested && leg.hub ? ` <span class="suggested-tag">— Recommended stop: <strong>${esc(leg.hub.name)} (${esc(leg.hub.code)})</strong></span>` : "";
      const links = airlineLinks(airportMap, leg.from, leg.to, leg.date, cabin, pax);
      const link = (l) => `<a class="book-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)} ${extIcon}</a>`;
      const top = links.slice(0, TOP_AIRLINES), more = links.slice(TOP_AIRLINES);
      html += `<div class="itin-leg">
        <div class="itin-leg-label">Flight ${i + 1}${tag}</div>
        <div class="itin-leg-route">${esc(airportLabel(airportMap, leg.from))} → ${esc(airportLabel(airportMap, leg.to))}</div>
        <div class="itin-leg-date">${esc(formatDate(leg.date))}</div>
        <div class="itin-leg-cost">~${esc(formatMoney(leg.cost || 0, currency))} estimated</div>
        <div class="book-links">
          <a class="book-link gf" href="${esc(googleFlightsUrl(leg.from, leg.to, leg.date, cabin, pax, currency))}" target="_blank" rel="noopener noreferrer">Google Flights ${extIcon}</a>
          ${top.map(link).join("")}
        </div>
        ${more.length ? `<details class="more-airlines"><summary>More airlines (${more.length})</summary><div class="book-links">${more.map(link).join("")}</div></details>` : ""}
      </div>`;
    });

    html += `<div class="itin-footer">
        <div class="itin-actions">
          <button type="button" class="ghost-btn" data-action="copy" data-idx="${idx}">Copy as text</button>
          <button type="button" class="ghost-btn" data-action="ics" data-idx="${idx}">Add to calendar (.ics)</button>
        </div>
        <div class="sub">Estimates are approximate — open the links for live prices. Each flight is booked separately.</div>
      </div></article>`;
  });
  $("results").innerHTML = html;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove(); return ok;
}

function flash(btn, msg) {
  const old = btn.textContent; btn.textContent = msg; btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1600);
}

$("results").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || !lastResults) return;
  const { itineraries, opts } = lastResults;
  const itin = itineraries[+btn.dataset.idx];
  if (btn.dataset.action === "share") {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "Plan My Trip", url: location.href }); return; } catch { /* cancelled: fall through to copy */ }
    }
    flash(btn, (await copyText(location.href)) ? "Link copied ✓" : "Copy failed");
  } else if (btn.dataset.action === "copy") {
    flash(btn, (await copyText(itineraryToText(itin, airportMap, opts))) ? "Copied ✓" : "Copy failed");
  } else if (btn.dataset.action === "ics") {
    const blob = new Blob([itineraryToICS(itin, airportMap, opts)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trip-${itin.codes.join("-")}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(btn, "Downloaded ✓");
  }
});

$("f").addEventListener("submit", (e) => { e.preventDefault(); plan(); });

// ---------------------------------------------------------------------------
// Startup: restore a shared link (and plan it), or the last search
// ---------------------------------------------------------------------------
const fromUrl = parseState(location.search);
const restored = fromUrl || parseState(storage.get() || "");
if (restored) applyState(restored); else updateDateFields();
if (fromUrl) dataLoaded.then(() => { if (dataReady) plan(); });
