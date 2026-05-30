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

function renderCards() {
  const filtered = (cache || []).filter((e) => e.dayIndex === selectedDay);
  filtered.sort((a, b) => {
    const at = Math.min(...(a.activities || []).map((x) => timeKey(x.time)));
    const bt = Math.min(...(b.activities || []).map((x) => timeKey(x.time)));
    return at - bt;
  });
  $cards.setAttribute('aria-busy', 'false');
  if (!filtered.length) {
    $cards.innerHTML = `<div class="empty"><strong>Pas encore de soirée pour ${DAYS_FULL[selectedDay]}.</strong>Le scraper ajoute dès qu'un message tombe dans le groupe.</div>`;
    return;
  }
  $cards.innerHTML = filtered.map(renderCard).join('');
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

// ── Map (Leaflet stub — markers stub par defaut Playa center) ──
const PLAYA_CENTER = [20.6296, -87.0739];
function ensureMap() {
  if (mapInstance || typeof L === 'undefined') return;
  mapInstance = L.map('map', { zoomControl: true, attributionControl: true }).setView(PLAYA_CENTER, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(mapInstance);
}

function renderMap() {
  ensureMap();
  if (!mapInstance) return;
  mapMarkers.forEach((m) => mapInstance.removeLayer(m));
  mapMarkers = [];
  const filtered = (cache || []).filter((e) => e.dayIndex === selectedDay);
  $mapCount.textContent = filtered.length;
  // TODO: geocodage venues. En attendant, marker fictif sur Playa center si events presents.
  if (filtered.length) {
    const m = L.marker(PLAYA_CENTER).addTo(mapInstance).bindPopup(
      `<strong>${filtered.length} soirée${filtered.length > 1 ? 's' : ''}</strong><br>${DAYS_FULL[selectedDay]}<br><em>Géocodage venues à venir</em>`
    );
    mapMarkers.push(m);
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
  selectedDay = Number(btn.dataset.day);
  refresh();
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
