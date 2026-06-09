// Playa Dance — dark UI in English: multi-tags, schedule grid, social sub-card,
// 7-cell day strip, rolling scroll across days, classic month calendar, map with
// geocoded venues, user location and OSRM walking time.

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Ordre d'affichage : lundi en premier, dimanche en dernier (convention europeenne).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Reciproque : jsWeekday (0=dim) -> position dans WEEK_ORDER (0=lun).
const monPos = (jsWeekday) => (jsWeekday + 6) % 7;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STYLE_HUE = { salsa: 35, bachata: 340, kizomba: 280, zouk: 175, merengue: 50, tango: 0, cumbia: 60 };
const STYLE_LABEL = { salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba', zouk: 'Zouk', merengue: 'Merengue', tango: 'Tango', cumbia: 'Cumbia' };

// Overrides : certains styles meritent une signature visuelle distincte de la formule
// "hue + sat/light standards". Le tango = vibe burgundy/wine, plus dark/sophistique
// que les oranges salsa/bachata, mais reste dans la famille warm de l'app.
const STYLE_GRADIENT_OVERRIDE = {
  tango: 'linear-gradient(135deg, hsl(348 60% 35%) 0%, hsl(355 55% 22%) 55%, hsl(8 45% 10%) 100%)',
};

const STYLE_RE = /\b(salsa|bachata|kizomba|zouk|merengue|tango|cumbia|cha[\s-]?cha)\b/i;
const LEVEL_RE = /\b(beginner|intermediate|advanced|advance|principiantes?|intermedios?|avanzados?|inicial(?:es)?|b[aá]sicos?|abiertos?|beg|int|adv|all\s*levels?|open\s*level)\b/i;
const LEVEL_RE_G = new RegExp(LEVEL_RE.source, 'gi');
const SOCIAL_RE = /\b(social(?:es)?|baile|party|fiestas?|milonga|bailando|night)\b/i;
// "Clase de Baile ..." contient "baile" mais reste une classe : contexte classe
// sans marqueur de soiree explicite -> pas un social.
const CLASS_CTX_RE = /\b(clases?|class(?:es)?|cours|workshop|taller|lecci[oó]n)\b/i;
const EXPLICIT_PARTY_RE = /\b(social(?:es)?|party|fiestas?|milonga)\b/i;

function normalizeLevel(raw) {
  const l = (raw || '').toLowerCase();
  if (/principiante|beginner|inicial|b[aá]sico|^beg$/.test(l)) return 'Beginner';
  if (/intermedio|intermediate|^int$/.test(l)) return 'Intermediate';
  if (/avanzado|advanced|advance|^adv$/.test(l)) return 'Advanced';
  if (/all\s*levels|abierto|open/.test(l)) return 'All levels';
  return raw;
}
// Sous-styles de danse : qualifient le style principal, vont a droite dans la meta
// (pas a gauche en tant que prof).
const SUBSTYLE_RE = /\b(tradicional|dominicana|moderna|sensual|urbana|figuras\s+sensuales|cubana|on\s*[12]|lineal|casino|rueda|tarraxa|ghetto\s+zouk|fusion|lad(?:y|ies)\s+styles?|parejas|musicalizaci[oó]n)\b/i;

const today = new Date();
const todayDayIndex = today.getDay();
let selectedDay = todayDayIndex;
let activeView = 'cards';
// Filtre global : 'all' (soirees + cours) ou 'parties' (soirees uniquement).
let filterMode = 'all';
try {
  if (localStorage.getItem('filterMode') === 'parties') filterMode = 'parties';
} catch { /* ignore */ }

// Filtre styles (multi-selection, vide = tous). Matching inclusif : un event
// mixte (ex SBK) s'affiche des qu'UN de ses styles est selectionne.
const STYLE_ORDER = ['salsa', 'bachata', 'kizomba', 'zouk', 'merengue', 'tango', 'cumbia'];
let styleFilter = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('styleFilter') || '[]');
  if (Array.isArray(saved)) styleFilter = new Set(saved.filter((s) => STYLE_HUE[s] !== undefined));
} catch { /* ignore */ }
let cache = null;
let cachedEtag = null;
let calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let mapInstance = null;
let mapMarkers = [];
let mapRouteLayer = null;
let userMarker = null;
let userMarkerCircle = null;
let userPos = null;
let venuesCache = null;

try {
  const last = localStorage.getItem('lastGeo');
  if (last) userPos = JSON.parse(last);
} catch { /* ignore */ }

const $caption = document.getElementById('today-caption');
const $filter = document.getElementById('filter-toggle');
const $styleChips = document.getElementById('style-chips');
const $strip = document.getElementById('day-strip');
const $cards = document.getElementById('cards');
const $cal = document.getElementById('calendar');
const $calGrid = document.getElementById('cal-grid');
const $calLabel = document.getElementById('cal-month-label');
const $mapView = document.getElementById('map-view');
const $mapCount = document.getElementById('map-count');
const $tabbar = document.querySelector('.tabbar');

$caption.textContent = `Today · ${DAYS_FULL[todayDayIndex]} ${MONTHS_FULL[today.getMonth()]} ${today.getDate()}`;

// Etat initial du toggle (filterMode peut venir du localStorage).
$filter.querySelectorAll('button').forEach((b) => {
  const active = b.dataset.filter === filterMode;
  b.classList.toggle('active', active);
  b.setAttribute('aria-pressed', String(active));
});

function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function dateOfWeekday(dayIndex) {
  const diff = (dayIndex - todayDayIndex + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  return d.getDate();
}

function detectStyles(activities, title = '', venue = '') {
  const found = new Set();
  const texts = [
    ...(activities || []).map((a) => a.name || ''),
    title || '',
    venue || '',
  ];
  for (const t of texts) {
    let m;
    const re = new RegExp(STYLE_RE.source, 'gi');
    while ((m = re.exec(t)) !== null) {
      const key = m[1].toLowerCase().replace(/[\s-]/g, '');
      // !== undefined : tango est mappe a hue 0 (rouge), 0 est falsy en JS
      // donc un simple truthy check sautait le tango. Bug visible : tag
      // 'Clase De' au lieu de 'Tango', gradient bleu nuit au lieu de burgundy.
      if (STYLE_HUE[key] !== undefined) found.add(key);
    }
    // "SBK" = soiree mixte salsa/bachata/kizomba.
    if (/\bsbk\b/i.test(t)) { found.add('salsa'); found.add('bachata'); found.add('kizomba'); }
  }
  return [...found];
}

function eventStyles(ev) {
  return detectStyles(ev.activities, ev.title, ev.venue);
}

function styleGradient(styles) {
  if (!styles.length) return 'linear-gradient(135deg, hsl(220 22% 28%), hsl(220 22% 14%))';
  if (styles.length === 1) {
    if (STYLE_GRADIENT_OVERRIDE[styles[0]]) return STYLE_GRADIENT_OVERRIDE[styles[0]];
    const h = STYLE_HUE[styles[0]];
    return `linear-gradient(135deg, hsl(${h} 78% 55%) 0%, hsl(${h} 75% 38%) 55%, hsl(${h} 50% 18%) 100%)`;
  }
  const [s1, s2] = styles;
  const h1 = STYLE_HUE[s1], h2 = STYLE_HUE[s2];
  const diff = ((h2 - h1 + 540) % 360) - 180;
  const hMid = (h1 + diff / 2 + 360) % 360;
  return `linear-gradient(135deg, hsl(${h1} 78% 55%) 0%, hsl(${hMid} 70% 45%) 50%, hsl(${h2} 70% 35%) 100%)`;
}

function isSocial(a) {
  const name = a?.name || '';
  if (!SOCIAL_RE.test(name)) return false;
  // "Clase de Baile de Casino" matche "baile" mais c'est une classe.
  if (CLASS_CTX_RE.test(name) && !EXPLICIT_PARTY_RE.test(name)) return false;
  return true;
}

function eventHasSocial(ev) { return (ev.activities || []).some(isSocial); }

// Events visibles selon le toggle Soirees/Tout + le filtre styles (cumulatifs).
function visibleEvents() {
  let evs = cache || [];
  if (filterMode === 'parties') evs = evs.filter(eventHasSocial);
  if (styleFilter.size) evs = evs.filter((e) => eventStyles(e).some((s) => styleFilter.has(s)));
  return evs;
}

// Filler words a stripper du nom de l'activite : ne sont ni profs ni info utile.
// Inclut les phrases de notice "2 classes at the same time", "al mismo tiempo".
const FILLER_RE = /\b(clases?\s*de|class(?:es)?\s*of|classes\s*at\s*the\s*same\s*time|at\s*the\s*same\s*time|al\s*mismo\s*tiempo|cours\s*de|clases?|class(?:es)?|lesson|workshop|taller|con|with|nivel(?:es)?|bailes?|de|of|du|le|la|the|y|and)\b/gi;

// Title-case Unicode-safe : \b\w casse sur les accents ("CallejóN") car \w
// ne matche pas ó. On ne capitalise qu'apres un non-lettre.
function titleCaseUnicode(s) {
  return (s || '').toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, pre, c) => pre + c.toUpperCase());
}

function decomposeWorkshop(name) {
  const styleMatch = (name || '').match(STYLE_RE);
  const style = styleMatch ? STYLE_LABEL[styleMatch[1].toLowerCase().replace(/[\s-]/g, '')] || styleMatch[1] : '';

  // Tous les niveaux mentionnes (ex "Principiante e Intermedio" -> 2 niveaux).
  const levels = [...(name || '').matchAll(LEVEL_RE_G)]
    .map((m) => normalizeLevel(m[1]))
    .filter((l, i, arr) => arr.indexOf(l) === i); // dedup

  const subStyleMatch = (name || '').match(SUBSTYLE_RE);
  const subStyle = subStyleMatch ? titleCaseUnicode(subStyleMatch[1]) : '';

  // Replace globaux : "Salsa Cubana Casino" a 2 sous-styles, un replace simple
  // n'en stripperait qu'un et le reste polluerait le nom du prof.
  let who = (name || '')
    .replace(new RegExp(STYLE_RE.source, 'gi'), '')
    .replace(LEVEL_RE_G, '')
    .replace(new RegExp(SUBSTYLE_RE.source, 'gi'), '')
    .replace(FILLER_RE, '')
    .replace(/[()[\]]/g, '')           // strip parens
    .replace(/\s+[yeo]\s+/gi, ' ')     // strip conjonctions orphelines "e" / "y" / "o"
    .replace(/&/g, ' ')                // strip residual "&"
    .replace(/[\/\\|]+/g, ' ')         // strip slashes
    .replace(/\d+\s*(classes|clases)/gi, '') // strip "2 classes" residuals
    .replace(/^\s*\.m\.\s*/i, '')      // residu parser de "p.m." colle au nom
    .replace(/\s+/g, ' ')
    .trim();
  // Strip leading/trailing punctuation (inclut em dash U+2014, fleches et toute ponctuation residuelle).
  who = who.replace(/^[\s·,;:\-–—→›»>\/\\|*]+|[\s·,;:\-–—→›»>\/\\|*]+$/g, '').trim();
  // Si reste essentiellement de la ponctuation (< 2 lettres significatives), drop.
  const alphaCount = (who.match(/[a-zA-ZÀ-ſ]/g) || []).length;
  if (alphaCount < 2) who = '';
  if (who && who === who.toUpperCase()) {
    who = titleCaseUnicode(who);
  }
  return { who, style, levels, subStyle };
}

// Construit la ligne (left, meta) :
//   - prof identifie         → left = nom du prof, meta = "Style · SubStyle · Level"
//   - style + sous-style     → left = "Style · SubStyle", meta = level (si dispo)
//   - style sans sous-style  → left = "Style class", meta = level
//   - juste un niveau        → left = "Level class", meta = ''
//   - rien d'utile           → left = nom brut
function makeWorkshopRow({ who, style, subStyle }, level, fallbackName) {
  let left, meta;
  if (who) {
    left = who;
    meta = [style, subStyle, level].filter(Boolean).join(' · ');
  } else if (style) {
    left = subStyle ? `${style} · ${subStyle}` : `${style} class`;
    meta = level || '';
  } else if (level) {
    left = `${level} class`;
    meta = '';
  } else if (subStyle) {
    left = subStyle;
    meta = '';
  } else {
    left = fallbackName;
    meta = '';
  }
  return { left, meta };
}

// Parse une borne ("7", "7:30", "8.30pm", "08 PM", "9p", "9:00p.m.") -> {h, min, ap}.
function parseClock(s) {
  const m = (s || '').toLowerCase().trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/);
  if (!m) return null;
  return { h: Number(m[1]), min: m[2] || '00', ap: m[3] || null };
}

// Resout une plage horaire en heures 24h, avec propagation du meridiem :
// "7-11PM" -> le 7 est pm aussi (19:00 — 23:00). "9-1am" -> soiree qui passe
// minuit, le 9 est pm (21:00 — 01:00). Split sur -, – et — (en/em dash).
function resolveRange(t) {
  const parts = (t || '').split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const clocks = parts.map(parseClock);
  if (clocks.some((c) => !c)) return null;
  const start = clocks[0];
  const end = clocks[clocks.length - 1];
  if (clocks.length > 1 && !start.ap && end.ap) {
    if (end.ap === 'p') {
      // "7-11pm" -> debut pm ; "11-1pm" traverse midi -> debut am.
      start.ap = end.h < start.h && start.h !== 12 ? 'a' : 'p';
    } else {
      // "9-1am" traverse minuit -> debut pm ; "9-11am" -> debut am.
      start.ap = end.h <= start.h && start.h !== 12 ? 'p' : 'a';
    }
  }
  return clocks.map((c) => {
    let h = c.h;
    if (c.ap === 'p' && h < 12) h += 12;
    else if (c.ap === 'a' && h === 12) h = 0;
    return { h, min: c.min };
  });
}

function fmtTime(t) {
  if (!t) return '';
  const range = resolveRange(t);
  if (!range) return t;
  return range.map((c) => `${String(c.h).padStart(2, '0')}:${c.min}`).join(' — ');
}

function timeKey(t) {
  const range = resolveRange(t);
  if (!range) return 9999;
  return range[0].h * 100 + Number(range[0].min);
}

function cleanVenueShort(v) {
  return (v || '')
    .replace(/^(the|la|el|le)\s+/i, '')
    .split(/[,;]/)[0]
    .trim()
    // Capitalise les debuts de mots sans casser les accents ("Callejón", pas "CallejóN").
    .replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase());
}

function titleFor(ev) {
  const t = (ev.title || '').trim();
  return t || cleanVenueShort(ev.venue) || `${DAYS_FULL[ev.dayIndex]} night`;
}

// Lien maps garanti pour un venue. Les anciennes donnees ont des mapUrl
// Instagram/linkfly (parser qui stockait n'importe quelle URL) ou pas de
// mapUrl du tout : on ne sert mapUrl que si c'est un vrai lien carte, sinon
// on retombe sur une recherche Google Maps "venue, Playa del Carmen".
const MAPS_LINK_RE = /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]{2,10}\/maps|maps\.google|share\.google|(www\.)?waze\.com|maps\.apple\.com)/i;
function venueMapHref(mapUrl, venueName) {
  const u = (mapUrl || '').trim();
  if (u && MAPS_LINK_RE.test(u)) return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  const name = (venueName || '').trim();
  if (!name) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, Playa del Carmen`)}`;
}

function firstActivityTimeKey(ev) {
  const times = (ev.activities || []).map((x) => timeKey(x.time));
  return times.length ? Math.min(...times) : 9999;
}

// ── Day strip ─────────────────────────────────────────────
function renderDayStrip() {
  $strip.innerHTML = WEEK_ORDER.map((i) => {
    const label = DAYS_SHORT[i];
    const active = i === selectedDay;
    const isToday = i === todayDayIndex;
    const num = dateOfWeekday(i);
    return `<button type="button" data-day="${i}" class="${active ? 'active' : ''} ${isToday ? 'is-today' : ''}" aria-pressed="${active}" aria-label="${DAYS_FULL[i]} ${num}">
      <span class="ds-name">${label}</span>
      <span class="ds-num">${num}</span>
    </button>`;
  }).join('');
}

// ── Card ──────────────────────────────────────────────────
function renderCard(ev) {
  // Titre et venue participent a la detection : "MAJAO Salsa y Bachata" tagge
  // Salsa/Bachata meme si les activites ne nomment pas le style.
  const styles = eventStyles(ev);
  const gradient = styleGradient(styles);
  // Tags : styles standards d'abord ; sinon "Party" si social present ; sinon
  // un keyword extrait du titre ou de l'activite ("LINE DANCE..." -> "Line Dance").
  let tagLabels;
  if (styles.length) {
    tagLabels = styles.slice(0, 3).map((s) => STYLE_LABEL[s] || s);
  } else if (eventHasSocial(ev)) {
    tagLabels = ['Party'];
  } else {
    const src = (ev.title || '').trim() || (ev.activities || [])[0]?.name || '';
    if (src) {
      const words = src.split(/\s+/).slice(0, 2);
      tagLabels = [titleCaseUnicode(words.join(' '))];
    } else {
      tagLabels = ['Class'];
    }
  }
  const tagsHTML = tagLabels.map((t) => `<span class="tag"><span class="dot"></span>${escapeHTML(t)}</span>`).join('');
  // Tag prix distinct, accent jaune/orange pour le faire ressortir.
  const priceHTML = ev.price
    ? `<span class="tag tag-price">${escapeHTML(ev.price)}</span>`
    : '';
  const tags = tagsHTML + priceHTML;

  const num = dateOfWeekday(ev.dayIndex);
  const dayLabel = DAYS_SHORT[ev.dayIndex].toUpperCase();
  const title = titleFor(ev);
  const venue = cleanVenueShort(ev.venue);
  const venueHref = venueMapHref(ev.mapUrl, ev.venue);
  const venueHTML = venue
    ? `<div class="card-loc"><span class="arrow" aria-hidden="true">↗</span><span class="vlabel">${venueHref ? `<a href="${escapeHTML(venueHref)}" target="_blank" rel="noopener">${escapeHTML(venue)}</a>` : escapeHTML(venue)}</span></div>`
    : '';

  const acts = (ev.activities || []).slice().sort((a, b) => timeKey(a.time) - timeKey(b.time));
  // En mode "parties", on ne montre que la/les soirees : pas de section Classes.
  const workshops = filterMode === 'parties' ? [] : acts.filter((a) => !isSocial(a));
  const socials = acts.filter(isSocial);

  // Une ligne par activite. Si plusieurs niveaux sont detectes (ex "Beginner & Intermediate"),
  // on les combine en une seule etiquette : c'est UNE classe couvrant les 2 niveaux,
  // pas 2 classes paralleles.
  const workshopRows = workshops.map((a) => {
    const d = decomposeWorkshop(a.name);
    // Abrege systematiquement les niveaux : "Beginner" -> "Beg" etc. + sans espace autour du "/".
    const lvls = d.levels.map((l) =>
      l.replace(/^Beginner$/, 'Beg').replace(/^Intermediate$/, 'Int').replace(/^Advanced$/, 'Adv').replace(/intermediate\/advanced/i, 'Int/Adv')
    );
    const levelLabel = lvls.length ? lvls.join('/') : '';
    const { left, meta } = makeWorkshopRow(d, levelLabel, a.name);
    return { time: a.time, left, meta };
  });

  const workshopsHTML = workshopRows.length
    ? `<div>
        <div class="sched-label">Classes</div>
        <ul class="sched-list">${workshopRows
          .map(
            (r) => `<li>
            <span class="t">${escapeHTML(fmtTime(r.time))}</span>
            <span class="info">
              <span class="n" dir="auto">${escapeHTML(r.left)}</span>${r.meta ? `<span class="meta">${escapeHTML(r.meta)}</span>` : ''}
            </span>
          </li>`
          )
          .join('')}</ul>
      </div>`
    : '';

  // Toutes les soirees, pas seulement la premiere (certains venues ont
  // pre-party + social, ou deux socials successifs).
  const socialHTML = socials
    .map(
      (s) => `<div class="social-box">
        <div class="sb-meta">
          <span class="sb-label">Party</span>
          <span class="sb-time">${escapeHTML(fmtTime(s.time))}</span>
          <span class="sb-title">${escapeHTML(s.name || 'Social Dance')}</span>
        </div>
        <span class="sb-arrow" aria-hidden="true">▶</span>
      </div>`
    )
    .join('');

  return `<article class="card" style="--card-gradient: ${gradient}">
    <div class="card-top">
      <div class="tags">${tags}</div>
      <div class="day-badge">
        <div class="d-num">${num}</div>
        <div class="d-label">${dayLabel}</div>
      </div>
    </div>
    <div class="card-bottom-text">
      <h2 class="card-title" dir="auto">${escapeHTML(title)}</h2>
      ${venueHTML}
      <div class="schedule">
        ${workshopsHTML}
        ${socialHTML}
      </div>
    </div>
  </article>`;
}

// ── Cards view with rolling scroll across days ────────────
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
  const events = visibleEvents();
  const sections = [];
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (selectedDay + offset) % 7;
    const evs = events.filter((e) => e.dayIndex === dayIdx);
    if (offset > 0 && evs.length === 0) continue;
    evs.sort((a, b) => firstActivityTimeKey(a) - firstActivityTimeKey(b));
    sections.push({ dayIdx, events: evs });
  }
  if (!sections.length || (sections.length === 1 && !sections[0].events.length)) {
    const filtersActive = filterMode === 'parties' || styleFilter.size > 0;
    $cards.innerHTML = filtersActive
      ? `<div class="empty"><strong>Nothing matches the current filters.</strong>Try removing a style filter or switching back to All.</div>`
      : `<div class="empty"><strong>No party scheduled this week yet.</strong>The scraper will add them as soon as a message lands in the group.</div>`;
    return;
  }
  $cards.innerHTML = sections
    .map((sec, i) => {
      const empty = sec.events.length === 0;
      const nextLabel = sections[i + 1] ? DAYS_FULL[sections[i + 1].dayIdx] : null;
      // "events" en mode all (la plupart sont des soirs de cours), "parties" en mode soirees.
      const noun = filterMode === 'parties'
        ? `part${sec.events.length > 1 ? 'ies' : 'y'}`
        : `event${sec.events.length > 1 ? 's' : ''}`;
      const headerHTML = `<div class="day-section-header">
        <span class="dsh-day">${DAYS_FULL[sec.dayIdx]}</span>
        <span class="dsh-count">${empty ? '—' : `${sec.events.length} ${noun}`}</span>
      </div>`;
      const bodyHTML = empty
        ? `<div class="day-empty">No party scheduled yet.${nextLabel ? `<br><span class="de-hint">Keep scrolling for ${nextLabel} ↓</span>` : ''}</div>`
        : sec.events.map(renderCard).join('');
      return `<div class="day-section" data-day="${sec.dayIdx}">${headerHTML}${bodyHTML}</div>`;
    })
    .join('');
  setupScrollSpy();
}

// ── Calendar month grid ───────────────────────────────────
function renderCalendar() {
  const month = calCursor.getMonth();
  const year = calCursor.getFullYear();
  $calLabel.textContent = `${MONTHS_FULL[month]} ${year}`;
  const countByDayIdx = Array(7).fill(0);
  for (const e of visibleEvents()) countByDayIdx[e.dayIndex]++;

  const first = new Date(year, month, 1);
  // Decalage en convention lundi-first : 0 si le 1er du mois est un lundi, 6 si dimanche.
  const startOffset = monPos(first.getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells = [];
  // Cases du mois precedent qui completent la 1ere semaine.
  for (let i = startOffset - 1; i >= 0; i--) {
    const date = daysInPrev - i;
    const dt = new Date(year, month - 1, date);
    cells.push({ date, dayIdx: dt.getDay(), other: true, month: month - 1 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    cells.push({ date: d, dayIdx: dt.getDay(), other: false, month });
  }
  // Completer 42 cases (6 semaines) avec le mois suivant.
  let nextDate = 1;
  while (cells.length < 42) {
    const dt = new Date(year, month + 1, nextDate);
    cells.push({ date: nextDate, dayIdx: dt.getDay(), other: true, month: month + 1 });
    nextDate++;
  }

  $calGrid.innerHTML = cells
    .map((c) => {
      const count = countByDayIdx[c.dayIdx];
      const isToday = !c.other && c.month === today.getMonth() && c.date === today.getDate() && year === today.getFullYear();
      const dots = '<span></span>'.repeat(Math.min(count, 3));
      return `<button type="button" class="cal-day ${c.other ? 'is-other' : ''} ${count ? 'has-events' : ''} ${isToday ? 'is-today' : ''}" data-day="${c.dayIdx}" aria-label="${c.date} (${count} event${count > 1 ? 's' : ''})">
        <span class="cd-num">${c.date}</span>
        ${count ? `<span class="cd-dots">${dots}</span>` : ''}
      </button>`;
    })
    .join('');
}

// ── Map (Leaflet bounded to Playa, geocoded venues, user position, OSRM walking) ──
const PLAYA_CENTER = [20.6296, -87.0739];
const PLAYA_BOUNDS = [[20.585, -87.105], [20.685, -87.04]];

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
// OSRM public demo ne supporte que driving — son champ duration ne reflete pas
// le foot. On calcule nous-meme : distance reelle (OSRM) ou Haversine * detour,
// divisee par 5 km/h (vitesse marche moyenne).
function walkingMinutes(distMeters, isStraightLine = false) {
  if (distMeters == null) return null;
  const detour = isStraightLine ? 1.3 : 1; // si pas de routing, on majore
  const adjusted = distMeters * detour;
  const minutes = adjusted / 1000 / 5 * 60;
  return Math.max(1, Math.round(minutes));
}
function fmtWalk(distMeters, isStraightLine = false) {
  const m = walkingMinutes(distMeters, isStraightLine);
  if (m == null) return '';
  if (m < 60) return `${m} min walk`;
  return `${Math.floor(m / 60)}h ${m % 60}m walk`;
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
    () => { /* permission denied */ },
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

const routeCache = new Map(); // key: "lat1,lon1|lat2,lon2"
async function fetchRoute(from, to) {
  const key = `${from.lat.toFixed(5)},${from.lon.toFixed(5)}|${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  try {
    const r = await fetch(`/api/route?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`);
    const data = await r.json();
    if (!data.ok) { routeCache.set(key, null); return null; }
    routeCache.set(key, data);
    return data;
  } catch { routeCache.set(key, null); return null; }
}

function clearMarkers() {
  mapMarkers.forEach((m) => mapInstance.removeLayer(m));
  mapMarkers = [];
  if (userMarker) { mapInstance.removeLayer(userMarker); userMarker = null; }
  if (userMarkerCircle) { mapInstance.removeLayer(userMarkerCircle); userMarkerCircle = null; }
  if (mapRouteLayer) { mapInstance.removeLayer(mapRouteLayer); mapRouteLayer = null; }
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

function showRoute(venueCoords) {
  if (!userPos || !mapInstance) return;
  fetchRoute(userPos, venueCoords).then((route) => {
    if (mapRouteLayer) { mapInstance.removeLayer(mapRouteLayer); mapRouteLayer = null; }
    if (!route || !route.geometry) return;
    mapRouteLayer = L.geoJSON(route.geometry, {
      style: { color: '#ff7a3d', weight: 4, opacity: 0.85, dashArray: '0' },
    }).addTo(mapInstance);
  });
}

async function renderMap() {
  ensureMap();
  if (!mapInstance) return;
  clearMarkers();
  if (!userPos) requestGeolocation();

  const venues = await loadVenues();
  // En mode "parties", on ne garde que les venues dont un event visible (= avec
  // soiree) tombe le jour selectionne. /api/map ne renvoie pas les activities,
  // on matche donc par id sur le cache de /api/events.
  const visibleIds = cache ? new Set(visibleEvents().map((e) => e.id)) : null;
  const matchesFilter = (ev) => filterMode === 'all' || !visibleIds || visibleIds.has(ev.id);
  const forDay = venues.filter((v) =>
    v.events.some((ev) => ev.dayIndex === selectedDay && matchesFilter(ev)) && v.lat != null && v.lon != null
  );
  $mapCount.textContent = forDay.length;

  if (userPos && userPos.lat && userPos.lon) {
    userMarker = L.marker([userPos.lat, userPos.lon], { icon: userIcon(), interactive: false }).addTo(mapInstance);
    userMarkerCircle = L.circle([userPos.lat, userPos.lon], { radius: 60, color: '#3ea3ff', weight: 1, fillOpacity: 0.12 }).addTo(mapInstance);
  }

  for (const v of forDay) {
    const evsForDay = v.events.filter((ev) => ev.dayIndex === selectedDay && matchesFilter(ev));
    const count = evsForDay.length;
    const evList = evsForDay.map((ev) => `<div class="vp-row">${escapeHTML((ev.title || v.displayName).slice(0, 70))}</div>`).join('');
    const dist = userPos ? distanceMeters(userPos, { lat: v.lat, lon: v.lon }) : null;
    // Premier affichage : Haversine (ligne droite) + estimate avec detour 1.3x.
    const distHTML = dist != null
      ? `<div class="vp-dist" id="vp-dist-${v.venueKey}">🚶 ${fmtWalk(dist, true)} · ${fmtDist(dist)}</div>`
      : '';
    const dirHref = venueMapHref(v.mapUrl, v.displayName);
    const link = dirHref ? `<div class="vp-link"><a href="${escapeHTML(dirHref)}" target="_blank" rel="noopener">Directions ↗</a></div>` : '';
    const popupHTML = `<strong>${escapeHTML(v.displayName)}</strong>${distHTML}<div class="vp-evs">${evList}</div>${link}`;
    const m = L.marker([v.lat, v.lon], { icon: venueIcon(count) }).addTo(mapInstance).bindPopup(popupHTML);
    m.on('popupopen', async () => {
      showRoute({ lat: v.lat, lon: v.lon });
      if (userPos) {
        const route = await fetchRoute(userPos, { lat: v.lat, lon: v.lon });
        const el = document.getElementById(`vp-dist-${v.venueKey}`);
        // OSRM nous donne la distance ROUTIERE precise — on l'utilise pour le temps de marche.
        if (el && route) el.innerHTML = `🚶 ${fmtWalk(route.distanceMeters, false)} · ${fmtDist(route.distanceMeters)}`;
      }
    });
    mapMarkers.push(m);
  }

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
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $cards.hidden = view !== 'cards';
  $cal.hidden = view !== 'calendar';
  $mapView.hidden = view !== 'map';
  // Day strip is only useful for cards + map (calendar already shows all days).
  $strip.hidden = view === 'calendar';
  refresh();
}

// Chips de styles : uniquement les styles presents dans les donnees (+ ceux
// deja selectionnes, pour pouvoir les deselectionner si les donnees changent).
function renderStyleChips() {
  const present = new Set();
  for (const e of cache || []) eventStyles(e).forEach((s) => present.add(s));
  styleFilter.forEach((s) => present.add(s));
  $styleChips.innerHTML = STYLE_ORDER.filter((s) => present.has(s))
    .map((s) => {
      const active = styleFilter.has(s);
      return `<button type="button" data-style="${s}" class="chip ${active ? 'active' : ''}" aria-pressed="${active}" style="--chip-hue: ${STYLE_HUE[s]}">
        <span class="dot"></span>${STYLE_LABEL[s]}
      </button>`;
    })
    .join('');
}

function refresh() {
  renderDayStrip();
  renderStyleChips();
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

$filter.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn || btn.dataset.filter === filterMode) return;
  filterMode = btn.dataset.filter;
  try { localStorage.setItem('filterMode', filterMode); } catch { /* ignore */ }
  $filter.querySelectorAll('button').forEach((b) => {
    const active = b.dataset.filter === filterMode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  refresh();
});

$styleChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-style]');
  if (!btn) return;
  const s = btn.dataset.style;
  if (styleFilter.has(s)) styleFilter.delete(s);
  else styleFilter.add(s);
  try { localStorage.setItem('styleFilter', JSON.stringify([...styleFilter])); } catch { /* ignore */ }
  refresh();
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
