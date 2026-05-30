// Playa Dance — UI dark moderne.

const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Gradient thematique par jour (du dimanche au samedi).
const DAY_GRADIENT = [
  'linear-gradient(135deg, #ff7a3d 0%, #ff2e63 55%, #6a1b9a 100%)',  // dim - sunset
  'linear-gradient(135deg, #1e3a8a 0%, #6366f1 100%)',                // lun - night blue
  'linear-gradient(135deg, #e11d48 0%, #7f1d1d 100%)',                // mar - red
  'linear-gradient(135deg, #0d9488 0%, #134e4a 100%)',                // mer - teal
  'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',                // jeu - amber
  'linear-gradient(135deg, #ec4899 0%, #f43f5e 60%, #be185d 100%)',   // ven - pink
  'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',                // sam - violet
];

const todayDayIndex = new Date().getDay();
let selectedDay = todayDayIndex;
let activeView = 'cards';
let cache = null;

const $today = document.getElementById('today-caption');
const $navDays = document.getElementById('days');
const $cards = document.getElementById('cards');
const $calendar = document.getElementById('calendar');
const $weekGrid = document.getElementById('week-grid');
const $tabbar = document.querySelector('.tabbar');

const todayDate = new Date();
$today.textContent = `Aujourd'hui · ${DAYS_FULL[todayDayIndex]} ${todayDate.getDate()} ${MONTHS_FR[todayDate.getMonth()]}`;

function isSocial(name) {
  return /(social|baile|party)/i.test(name || '');
}

function inferCategory(ev) {
  const all = (ev.activities || []).map((a) => a.name || '').join(' ').toLowerCase();
  if (/kizomba/.test(all)) return 'Kizomba';
  if (/bachata/.test(all)) return 'Bachata';
  if (/salsa/.test(all)) return 'Salsa';
  if (/zouk/.test(all)) return 'Zouk';
  if (/social|baile|party/.test(all)) return 'Social';
  return 'Soirée';
}

function cleanVenue(v) {
  return (v || '').replace(/^(the|la|el|le)\s+/i, '').replace(/,\s*avenida.*/i, '').replace(/[#@].*$/, '').trim();
}

function titleOrVenue(ev) {
  if (ev.title && ev.title.trim()) return ev.title.trim();
  return cleanVenue(ev.venue) || `Soirée ${DAYS_FULL[ev.dayIndex]}`;
}

function shortVenue(ev) {
  const v = cleanVenue(ev.venue);
  if (!v) return null;
  return v.length > 50 ? v.slice(0, 47) + '…' : v;
}

function renderDayChips() {
  $navDays.innerHTML = DAYS_SHORT.map(
    (d, i) =>
      `<button type="button" data-day="${i}" class="${i === selectedDay ? 'active' : ''} ${i === todayDayIndex ? 'is-today' : ''}" aria-selected="${i === selectedDay}">${d}</button>`
  ).join('');
}

function eventCard(ev) {
  const gradient = DAY_GRADIENT[ev.dayIndex] || DAY_GRADIENT[0];
  const cat = inferCategory(ev);
  const venue = shortVenue(ev);
  const title = titleOrVenue(ev);
  const acts = (ev.activities || [])
    .slice(0, 6)
    .map(
      (a) =>
        `<span class="act ${isSocial(a.name) ? 'is-social' : ''}"><span class="t">${escapeHTML(a.time || '')}</span><span class="n">${escapeHTML(a.name || '')}</span></span>`
    )
    .join('');
  const venueHTML = venue
    ? `<div class="card-venue">📍 ${ev.mapUrl ? `<a href="${escapeAttr(ev.mapUrl)}" target="_blank" rel="noopener">${escapeHTML(venue)}</a>` : escapeHTML(venue)}</div>`
    : '';

  return `<article class="card" style="--card-gradient: ${gradient}">
    <div class="card-top">
      <span class="card-tag">${escapeHTML(cat)}</span>
      <span class="day-badge"><span class="d-num">${DAYS_SHORT[ev.dayIndex]}</span><span class="d-label">${escapeHTML((ev.day || '').slice(0, 3))}</span></span>
    </div>
    <div class="card-bottom">
      <h2 class="card-title">${escapeHTML(title)}</h2>
      ${venueHTML}
      ${acts ? `<div class="activities">${acts}</div>` : ''}
    </div>
  </article>`;
}

function renderCards(events) {
  if (!events || !events.length) {
    $cards.innerHTML = `<div class="empty"><strong>Aucune soirée pour ${DAYS_FULL[selectedDay]}.</strong>Les soirées arrivent dès qu'un message tombe dans le groupe.</div>`;
    return;
  }
  $cards.innerHTML = events.map(eventCard).join('');
}

function renderCalendar(allEvents) {
  const byDay = Array.from({ length: 7 }, () => []);
  for (const ev of allEvents) byDay[ev.dayIndex]?.push(ev);

  $weekGrid.innerHTML = DAYS_SHORT.map((label, i) => {
    const count = byDay[i].length;
    const dots = '<span class="dot"></span>'.repeat(Math.min(count, 4));
    return `<button type="button" class="cell ${count ? '' : 'empty'} ${i === todayDayIndex ? 'is-today' : ''}" data-day="${i}">
      <span class="cd-label">${label}</span>
      <span class="cd-count">${count || '·'}</span>
      <span class="dots">${dots}</span>
    </button>`;
  }).join('');

  const daysWithEvents = byDay.map((evs, i) => ({ i, evs })).filter((x) => x.evs.length);
  const blocks = daysWithEvents
    .map(
      ({ i, evs }) => `<div class="day-block">
        <h3>${DAYS_FULL[i]} · ${evs.length} soirée${evs.length > 1 ? 's' : ''}</h3>
        <ul>${evs
          .map((ev) => {
            const v = shortVenue(ev);
            const t = titleOrVenue(ev);
            const first = (ev.activities || [])[0];
            return `<li><div><div class="title">${escapeHTML(t)}</div>${v ? `<div class="venue">${escapeHTML(v)}</div>` : ''}</div>${first ? `<span class="meta">${escapeHTML(first.time)}</span>` : ''}</li>`;
          })
          .join('')}</ul>
      </div>`
    )
    .join('');
  document.querySelectorAll('.day-block').forEach((n) => n.remove());
  $weekGrid.insertAdjacentHTML('afterend', blocks);
}

async function load() {
  try {
    const res = await fetch('/api/events');
    cache = (await res.json()).events || [];
  } catch {
    cache = [];
  }
  refresh();
}

function refresh() {
  renderDayChips();
  if (activeView === 'cards') {
    const filtered = (cache || []).filter((e) => e.dayIndex === selectedDay);
    filtered.sort((a, b) => (a.activities?.[0]?.time || '').localeCompare(b.activities?.[0]?.time || ''));
    renderCards(filtered);
  } else {
    renderCalendar(cache || []);
  }
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'cards') {
    $cards.hidden = false;
    $cards.setAttribute('aria-hidden', 'false');
    $calendar.hidden = true;
    $calendar.setAttribute('aria-hidden', 'true');
  } else {
    $cards.hidden = true;
    $cards.setAttribute('aria-hidden', 'true');
    $calendar.hidden = false;
    $calendar.setAttribute('aria-hidden', 'false');
  }
  refresh();
}

$navDays.addEventListener('click', (e) => {
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

document.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  selectedDay = Number(cell.dataset.day);
  switchView('cards');
});

function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s) { return escapeHTML(s); }

load();
setInterval(load, 60000);
