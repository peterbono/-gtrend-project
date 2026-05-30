// Playa Dance — refonte dark UI : multi-tags, schedule grid, social sub-card,
// 7-cell day strip, calendar mois classique, map stub Leaflet.

const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_FULL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Hue par style — gradient computed par event en blendant les hues detectees.
const STYLE_HUE = { salsa: 35, bachata: 340, kizomba: 280, zouk: 175, merengue: 50, tango: 20 };
const STYLE_LABEL = { salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba', zouk: 'Zouk', merengue: 'Merengue', tango: 'Tango' };

const STYLE_RE = /\b(salsa|bachata|kizomba|zouk|merengue|tango|cha[\s-]?cha)\b/i;
const LEVEL_RE = /\b(beginner|intermediate|advanced|principiantes?|intermedios?|avanzados?|beg|int|adv|all\s*levels?)\b/i;
const SOCIAL_RE = /\b(social|baile|party)\b/i;

const today = new Date();
const todayDayIndex = today.getDay();
let selectedDay = todayDayIndex;
let activeView = 'cards';
let cache = null;
let cachedEtag = null;
let calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let mapInstance = null;
let mapMarkers = [];

const $caption = document.getElementById('today-caption');
const $strip = document.getElementById('day-strip');
const $cards = document.getElementById('cards');
const $cal = document.getElementById('calendar');
const $calGrid = document.getElementById('cal-grid');
const $calLabel = document.getElementById('cal-month-label');
const $mapView = document.getElementById('map-view');
const $mapCount = document.getElementById('map-count');
const $tabbar = document.querySelector('.tabbar');

$caption.textContent = `${DAYS_FULL[todayDayIndex]} ${today.getDate()} ${MONTHS_FR[today.getMonth()]}`;

// ── Helpers ────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dateOfWeekday(dayIndex) {
  // Date de la prochaine occurrence (ou aujourd'hui si == today).
  const diff = (dayIndex - todayDayIndex + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  return d.getDate();
}

function detectStyles(activities) {
  const found = new Set();
  for (const a of activities || []) {
    const m = (a.name || '').match(STYLE_RE);
    if (m) {
      const key = m[1].toLowerCase().replace(/[\s-]/g, '');
      if (STYLE_HUE[key]) found.add(key);
    }
  }
  return [...found];
}

function styleGradient(styles) {
  if (!styles.length) {
    return 'linear-gradient(135deg, hsl(220 22% 28%), hsl(220 22% 14%))';
  }
  if (styles.length === 1) {
    const h = STYLE_HUE[styles[0]];
    return `linear-gradient(135deg, hsl(${h} 78% 55%) 0%, hsl(${h} 75% 38%) 55%, hsl(${h} 50% 18%) 100%)`;
  }
  // 2+ : on prend les 2 premiers et on blend
  const [s1, s2] = styles;
  const h1 = STYLE_HUE[s1], h2 = STYLE_HUE[s2];
  // Couleur intermediaire = moyenne perceptuelle (HSL angle, chemin le plus court)
  const diff = ((h2 - h1 + 540) % 360) - 180;
  const hMid = (h1 + diff / 2 + 360) % 360;
  return `linear-gradient(135deg, hsl(${h1} 78% 55%) 0%, hsl(${hMid} 70% 45%) 50%, hsl(${h2} 70% 35%) 100%)`;
}

function isSocial(a) {
  return SOCIAL_RE.test(a?.name || '');
}

function decomposeWorkshop(name) {
  const styleMatch = (name || '').match(STYLE_RE);
  const levelMatch = (name || '').match(LEVEL_RE);
  const style = styleMatch ? STYLE_LABEL[styleMatch[1].toLowerCase().replace(/[\s-]/g, '')] || styleMatch[1] : '';
  let level = levelMatch ? levelMatch[1] : '';
  level = level.replace(/principiantes?/i, 'Débutant')
               .replace(/intermedios?/i, 'Intermédiaire')
               .replace(/avanzados?/i, 'Avancé')
               .replace(/beginner/i, 'Débutant')
               .replace(/intermediate/i, 'Intermédiaire')
               .replace(/advanced/i, 'Avancé')
               .replace(/beg\b/i, 'Déb')
               .replace(/int\b/i, 'Int')
               .replace(/adv\b/i, 'Adv');
  let who = (name || '').replace(STYLE_RE, '').replace(LEVEL_RE, '').replace(/\s+/g, ' ').trim();
  who = who.replace(/&/g, '·').replace(/[·,]\s*$/, '').trim();
  // Normalise casse : "MARCO" -> "Marco", "JAVI" -> "Javi" si tout caps
  if (who && who === who.toUpperCase()) {
    who = who.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return { who, style, level };
}

// "7p" -> "19:00", "9p-1a" -> "21:00 — 01:00", "21:00" -> "21:00"
function fmtTime(t) {
  if (!t) return '';
  const parts = t.split(/-/);
  const fmtOne = (s) => {
    const m = s.toLowerCase().trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?m?$/);
    if (!m) return s;
    let h = Number(m[1]);
    const min = m[2] || '00';
    const ap = m[3];
    if (ap === 'p' && h < 12) h += 12;
    else if (ap === 'a' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  };
  return parts.map(fmtOne).join(' — ');
}

// Pour tri : "7p" -> 1900, "9p-1a" -> 2100
function timeKey(t) {
  const m = (t || '').toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?/);
  if (!m) return 9999;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3];
  if (ap === 'p' && h < 12) h += 12;
  else if (ap === 'a' && h === 12) h = 0;
  return h * 100 + min;
}

function cleanVenueShort(v) {
  return (v || '')
    .replace(/^(the|la|el|le)\s+/i, '')
    .split(/[,;]/)[0]
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Avenida/i, 'Avenida');
}

function titleFor(ev) {
  const t = (ev.title || '').trim();
  return t || cleanVenueShort(ev.venue) || `Soirée ${DAYS_FULL[ev.dayIndex]}`;
}

// ── 7-cell day strip ──────────────────────────────────────
function renderDayStrip() {
  $strip.innerHTML = DAYS_SHORT.map((label, i) => {
    const active = i === selectedDay;
    const isToday = i === todayDayIndex;
    const num = dateOfWeekday(i);
    return `<button type="button" data-day="${i}" class="${active ? 'active' : ''} ${isToday ? 'is-today' : ''}" aria-pressed="${active}" aria-label="${DAYS_FULL[i]} ${num}">
      <span class="ds-name">${label}</span>
      <span class="ds-num">${num}</span>
    </button>`;
  }).join('');
}

// ── Card render ───────────────────────────────────────────
function renderCard(ev) {
  const styles = detectStyles(ev.activities);
  const gradient = styleGradient(styles);
  const tags = styles.length
    ? styles.slice(0, 3).map((s) => `<span class="tag"><span class="dot"></span>${escapeHTML(STYLE_LABEL[s] || s)}</span>`).join('')
    : '<span class="tag"><span class="dot"></span>Soirée</span>';

  const num = dateOfWeekday(ev.dayIndex);
  const dayLabel = DAYS_SHORT[ev.dayIndex].toUpperCase();
  const title = titleFor(ev);
  const venue = cleanVenueShort(ev.venue);
  const venueHTML = venue
    ? `<div class="card-loc"><span aria-hidden="true">↗</span> ${ev.mapUrl ? `<a href="${escapeHTML(ev.mapUrl)}" target="_blank" rel="noopener">${escapeHTML(venue)}</a>` : escapeHTML(venue)}</div>`
    : '';

  // Split workshops / social
  const acts = (ev.activities || []).slice().sort((a, b) => timeKey(a.time) - timeKey(b.time));
  const workshops = acts.filter((a) => !isSocial(a));
  const socials = acts.filter(isSocial);
  const social = socials[0]; // si plusieurs apres merge ca devrait pas arriver, on prend le 1er

  const workshopsHTML = workshops.length
    ? `<div>
        <div class="sched-label">Cours</div>
        <ul class="sched-list">${workshops.map((a) => {
          const { who, style, level } = decomposeWorkshop(a.name);
          const meta = [style, level].filter(Boolean).join(' · ');
          return `<li>
            <span class="t">${escapeHTML(fmtTime(a.time))}</span>
            <span class="n" dir="auto">${escapeHTML(who || a.name)}</span>
            <span class="meta">${escapeHTML(meta)}</span>
          </li>`;
        }).join('')}</ul>
      </div>`
    : '';

  const socialHTML = social
    ? `<div class="social-box">
        <div class="sb-meta">
          <span class="sb-label">Soirée</span>
          <span class="sb-time">${escapeHTML(fmtTime(social.time))}</span>
          <span class="sb-title">${escapeHTML(social.name || 'Social Dance')}</span>
        </div>
        <span class="sb-arrow" aria-hidden="true">▶</span>
      </div>`
    : '';

  return `<article class="card" style="--card-gradient: ${gradient}">
    <div class="card-top">
      <div class="tags">${tags}</div>
      <div class="day-badge">
        <div class="d-num">${num}</div>
        <div class="d-label">${dayLabel}</div>
      </div>
    </div>
    <div class="card-bottom-text">
      ${venue ? `<div class="card-eyebrow">${escapeHTML(venue.split(' ')[0])}</div>` : ''}
      <h2 class="card-title" dir="auto">${escapeHTML(title)}</h2>
      ${venueHTML}
      <div class="schedule">
        ${workshopsHTML}
        ${socialHTML}
      </div>
    </div>
  </article>`;
}

function firstActivityTimeKey(ev) {
  const times = (ev.activities || []).map((x) => timeKey(x.time));
  return times.length ? Math.min(...times) : 9999;
}

let scrollSpyObs = null;
let scrollSpyMuted = false;

function setupScrollSpy() {
  if (scrollSpyObs) scrollSpyObs.disconnect();
  const sections = $cards.querySelectorAll('.day-section');
  if (sections.length <= 1) return;
  scrollSpyObs = new IntersectionObserver(
    (entries) => {
      if (scrollSpyMuted) return;
      const visibles = entries.filter((e) => e.isIntersecting);
      if (!visibles.length) return;
      visibles.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const top = visibles[0].target;
      const day = Number(top.dataset.day);
      if (day !== selectedDay) {
        selectedDay = day;
        renderDayStrip();
      }
    },
    { rootMargin: '-170px 0px -55% 0px', threshold: 0 }
  );
  sections.forEach((s) => scrollSpyObs.observe(s));
}

function renderCards() {
  $cards.setAttribute('aria-busy', 'false');
  const events = cache || [];
  // Construit les sections : le jour selectionne en 1er (meme si vide),
  // puis les jours suivants qui ont des evenements (amorce/scroll continu).
  const sections = [];
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (selectedDay + offset) % 7;
    const evs = events.filter((e) => e.dayIndex === dayIdx);
    if (offset > 0 && evs.length === 0) continue;
    evs.sort((a, b) => firstActivityTimeKey(a) - firstActivityTimeKey(b));
    sections.push({ dayIdx, events: evs });
  }

  if (!sections.length || (sections.length === 1 && !sections[0].events.length)) {
    $cards.innerHTML = `<div class="empty"><strong>Aucune soirée connue cette semaine.</strong>Le scraper ajoute dès qu'un message tombe dans le groupe.</div>`;
    return;
  }

  $cards.innerHTML = sections
    .map((sec, i) => {
      const empty = sec.events.length === 0;
      const nextLabel = sections[i + 1] ? DAYS_FULL[sections[i + 1].dayIdx] : null;
      const headerHTML = `<div class="day-section-header">
        <span class="dsh-day">${DAYS_FULL[sec.dayIdx]}</span>
        <span class="dsh-count">${empty ? '—' : `${sec.events.length} soirée${sec.events.length > 1 ? 's' : ''}`}</span>
      </div>`;
      const bodyHTML = empty
        ? `<div class="day-empty">Pas encore de soirée prévue.${nextLabel ? `<br><span class="de-hint">Continue à scroller pour voir ${nextLabel.toLowerCase()} ↓</span>` : ''}</div>`
        : sec.events.map(renderCard).join('');
      return `<div class="day-section" data-day="${sec.dayIdx}">${headerHTML}${bodyHTML}</div>`;
    })
    .join('');

  setupScrollSpy();
}

// ── Calendar mois ─────────────────────────────────────────
function renderCalendar() {
  const month = calCursor.getMonth();
  const year = calCursor.getFullYear();
  $calLabel.textContent = `${MONTHS_FULL[month]} ${year}`;

  // events comptes par dayIndex (recurrent)
  const countByDayIdx = Array(7).fill(0);
  for (const e of cache || []) countByDayIdx[e.dayIndex]++;

  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0 dim
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells = [];
  // Cases du mois precedent
  for (let i = startWeekday - 1; i >= 0; i--) {
    const date = daysInPrev - i;
    cells.push({ date, dayIdx: (startWeekday - 1 - i + 7) % 7, other: true, month: month - 1 });
  }
  // Mois courant
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    cells.push({ date: d, dayIdx: dt.getDay(), other: false, month });
  }
  // Completer 42 cases (6 semaines)
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    cells.push({ date: cells.length - (startWeekday + daysInMonth) + 1, dayIdx: (last.dayIdx + 1) % 7, other: true, month: month + 1 });
  }

  $calGrid.innerHTML = cells
    .map((c) => {
      const count = countByDayIdx[c.dayIdx];
      const isToday = !c.other && c.month === today.getMonth() && c.date === today.getDate() && year === today.getFullYear();
      const dots = '<span></span>'.repeat(Math.min(count, 3));
      return `<button type="button" class="cal-day ${c.other ? 'is-other' : ''} ${count ? 'has-events' : ''} ${isToday ? 'is-today' : ''}" data-day="${c.dayIdx}" aria-label="${c.date} (${count} soirée${count > 1 ? 's' : ''})">
        <span class="cd-num">${c.date}</span>
        ${count ? `<span class="cd-dots">${dots}</span>` : ''}
      </button>`;
    })
    .join('');
}

// ── Map (Leaflet : bornee a Playa, geocodage Nominatim cote serveur, geolocation user) ──
const PLAYA_CENTER = [20.6296, -87.0739];
const PLAYA_BOUNDS = [[20.585, -87.105], [20.685, -87.04]];
let userMarker = null;
let userPos = null;
let venuesCache = null;
let userMarkerCircle = null;

try {
  const last = localStorage.getItem('lastGeo');
  if (last) userPos = JSON.parse(last);
} catch { /* ignore */ }

function ensureMap() {
  if (mapInstance || typeof L === 'undefined') return;
  mapInstance = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    maxBounds: PLAYA_BOUNDS,
    maxBoundsViscosity: 1.0,
    minZoom: 13,
    maxZoom: 18,
  }).fitBounds(PLAYA_BOUNDS, { padding: [10, 10] });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    bounds: PLAYA_BOUNDS,
  }).addTo(mapInstance);
}

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const s = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtDist(m) {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function requestGeolocation() {
  if (!navigator.geolocation || sessionStorage.getItem('geoRequested')) return;
  sessionStorage.setItem('geoRequested', '1');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      try { localStorage.setItem('lastGeo', JSON.stringify(userPos)); } catch { /* ignore */ }
      if (activeView === 'map') renderMap();
    },
    () => { /* permission refusee ou erreur — silent */ },
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 5 * 60_000 }
  );
}

async function loadVenues() {
  if (venuesCache) return venuesCache;
  try {
    const r = await fetch('/api/map');
    venuesCache = (await r.json()).venues || [];
  } catch { venuesCache = []; }
  return venuesCache;
}

function clearMarkers() {
  mapMarkers.forEach((m) => mapInstance.removeLayer(m));
  mapMarkers = [];
  if (userMarker) { mapInstance.removeLayer(userMarker); userMarker = null; }
  if (userMarkerCircle) { mapInstance.removeLayer(userMarkerCircle); userMarkerCircle = null; }
}

function venueIcon(count) {
  return L.divIcon({
    className: 'venue-pin',
    html: `<div class="vp-inner"><span>${count}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });
}

function userIcon() {
  return L.divIcon({
    className: 'user-pin',
    html: '<div class="up-dot"></div><div class="up-ring"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

async function renderMap() {
  ensureMap();
  if (!mapInstance) return;
  clearMarkers();

  // Demande la geoloc au 1er affichage de la map.
  if (!userPos) requestGeolocation();

  const venues = await loadVenues();
  const forDay = venues.filter((v) =>
    v.events.some((ev) => ev.dayIndex === selectedDay) && v.lat != null && v.lon != null
  );
  $mapCount.textContent = forDay.length;

  // User marker
  if (userPos && userPos.lat && userPos.lon) {
    userMarker = L.marker([userPos.lat, userPos.lon], { icon: userIcon(), interactive: false }).addTo(mapInstance);
    userMarkerCircle = L.circle([userPos.lat, userPos.lon], { radius: 60, color: '#3ea3ff', weight: 1, fillOpacity: 0.12 }).addTo(mapInstance);
  }

  // Venue markers
  for (const v of forDay) {
    const count = v.events.filter((ev) => ev.dayIndex === selectedDay).length;
    const evList = v.events
      .filter((ev) => ev.dayIndex === selectedDay)
      .map((ev) => `<div class="vp-row">${(ev.title || v.displayName).slice(0, 60)}</div>`)
      .join('');
    const dist = userPos ? distanceMeters(userPos, { lat: v.lat, lon: v.lon }) : null;
    const distHTML = dist != null ? `<div class="vp-dist">📍 ${fmtDist(dist)} de toi</div>` : '';
    const link = v.mapUrl ? `<div class="vp-link"><a href="${v.mapUrl}" target="_blank" rel="noopener">Itinéraire ↗</a></div>` : '';
    const m = L.marker([v.lat, v.lon], { icon: venueIcon(count) })
      .addTo(mapInstance)
      .bindPopup(`<strong>${v.displayName}</strong>${distHTML}<div class="vp-evs">${evList}</div>${link}`);
    mapMarkers.push(m);
  }

  // Si pas de venue ce jour, recadre Playa centre.
  if (!forDay.length) {
    mapInstance.fitBounds(PLAYA_BOUNDS, { padding: [10, 10] });
  } else {
    const group = L.featureGroup([...mapMarkers, ...(userMarker ? [userMarker] : [])]);
    mapInstance.fitBounds(group.getBounds().pad(0.2), { maxZoom: 16 });
  }

  setTimeout(() => mapInstance.invalidateSize(), 100);
}

// ── View switching ────────────────────────────────────────
function switchView(view) {
  activeView = view;
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  $cards.hidden = view !== 'cards';
  $cal.hidden = view !== 'calendar';
  $mapView.hidden = view !== 'map';
  refresh();
}

function refresh() {
  renderDayStrip();
  if (activeView === 'cards') renderCards();
  else if (activeView === 'calendar') renderCalendar();
  else if (activeView === 'map') renderMap();
}

// ── Data ──────────────────────────────────────────────────
async function load({ pollSkipIfHidden = false } = {}) {
  if (pollSkipIfHidden && document.visibilityState === 'hidden') return;
  try {
    const res = await fetch('/api/events', cachedEtag ? { headers: { 'If-None-Match': cachedEtag } } : {});
    if (res.status === 304) return;
    cachedEtag = res.headers.get('ETag');
    cache = (await res.json()).events || [];
  } catch {
    cache = cache || [];
  }
  refresh();
}

// ── Events ────────────────────────────────────────────────
$strip.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const day = Number(btn.dataset.day);
  if (day === selectedDay) return;
  selectedDay = day;
  if (activeView === 'cards') {
    // Re-render avec le jour clique en tete, puis scroll en haut.
    // Mute le scroll-spy le temps que le scroll smooth se cale.
    scrollSpyMuted = true;
    renderCards();
    renderDayStrip();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { scrollSpyMuted = false; }, 800);
  } else {
    refresh();
  }
});

$tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  switchView(btn.dataset.view);
});

$calGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-day');
  if (!cell) return;
  selectedDay = Number(cell.dataset.day);
  switchView('cards');
});

document.getElementById('cal-prev').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});

load();
setInterval(() => load({ pollSkipIfHidden: true }), 60_000);
