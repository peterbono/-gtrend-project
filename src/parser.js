import { detectDay } from './days.js';

// Retire emojis / puces / espaces en debut de ligne.
function stripLead(line) {
  return line
    .replace(/^[\s✅\u{1F525}\u{1F31F}\u{1F305}\u{1F4A5}\u{1F483}✨•\-–·*]+/u, '')
    .trim();
}

// Detecte une heure ou plage horaire en debut de ligne.
// Ex: "6p", "9-10p", "9p-1a", "7pm", "7-11p", "21:00".
const TIME_RE = /^(\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?(?:\s*[-–a]\s*\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?)?)\b/;

function parseTime(line) {
  const clean = stripLead(line);
  const m = clean.match(TIME_RE);
  if (!m) return null;
  const time = m[1].replace(/\s+/g, '').toLowerCase();
  const name = clean.slice(m[0].length).replace(/^[\s:–-]+/, '').trim();
  if (!name) return null; // une heure seule sans activite = pas fiable
  return { time, name };
}

const URL_RE = /(https?:\/\/\S+)/i;
const PIN = '\u{1F4CD}'; // 📍

// Parse un bloc texte WhatsApp en une liste d'evenements (un par jour trouve).
export function parseMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const events = [];
  let current = null;

  const push = () => {
    if (current && (current.activities.length || current.venue)) {
      events.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const day = detectDay(line);
    if (day) {
      // Nouveau bloc jour. Titre = ce qui suit un tiret, sinon le reste de la ligne.
      push();
      let title = '';
      const dash = line.split(/[–-]/);
      if (dash.length > 1) title = dash.slice(1).join('-').trim();
      title = title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').trim();
      current = {
        day: day.day,
        dayIndex: day.dayIndex,
        title,
        venue: null,
        mapUrl: null,
        activities: [],
      };
      continue;
    }

    if (!current) continue; // lignes avant le premier jour : ignorees

    if (line.includes(PIN)) {
      current.venue = line.split(PIN)[1].replace(/^[\s:]+/, '').trim() || current.venue;
      continue;
    }

    const url = line.match(URL_RE);
    if (url) {
      current.mapUrl = url[1];
      continue;
    }

    const t = parseTime(line);
    if (t) current.activities.push(t);
  }

  push();
  return events;
}

// Identifiant stable d'un evenement (pour dedup / upsert).
export function eventId(ev) {
  const key = (ev.venue || ev.title || ev.day).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${ev.dayIndex}-${key}`;
}
