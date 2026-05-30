import { detectDay } from './days.js';

// Retire emojis / puces / espaces / chiffres "1️⃣ 2️⃣ ..." en debut de ligne.
// Le sequence "N️⃣" est la "keycap" composite (ex: 1️⃣) — souvent
// utilisee pour numeroter les items dans une liste WhatsApp.
function stripLead(line) {
  return line
    .replace(/^([\d]️⃣|️⃣)+/u, '') // keycaps "1️⃣"
    .replace(/^[\s✅\u{1F525}\u{1F31F}\u{1F305}\u{1F4A5}\u{1F483}✨•\-–·*►▶▪◆▫○●–—]+/u, '')
    .trim();
}

// Markdown WhatsApp : *gras* / _italique_ / ~barre~ — on garde le texte, on vire la syntaxe.
function stripMarkdown(s) {
  return (s || '')
    .replace(/\*+([^*]+?)\*+/g, '$1')
    .replace(/_+([^_]+?)_+/g, '$1')
    .replace(/~+([^~]+?)~+/g, '$1')
    .replace(/&amp;/g, '&')
    .trim();
}

// Strippe filler espagnols/francais frequents devant un nom de lieu ou de titre.
function stripFillerPrefix(s) {
  return (s || '')
    .replace(/^\s*(lugar|lieu|place|venue|donde|where|adresse|address|direccion|dirección)\s*[:：]\s*/i, '')
    .replace(/^\s*[★⭐✨🎉]+\s*/u, '')
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
  let name = clean.slice(m[0].length).replace(/^[\s:–-]+/, '').trim();
  name = stripMarkdown(name);
  // Nettoie les keycaps numerotes residuels au milieu : "5️⃣pm" etc.
  name = name.replace(/[\d]️⃣/gu, '').replace(/️⃣/gu, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) return null;
  return { time, name };
}

const URL_RE = /(https?:\/\/\S+)/i;
const ONLY_URL_RE = /^\s*https?:\/\/\S+\s*$/i;
const ONLY_TIME_RE = /^\s*\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?\s*$/;
const PIN = '\u{1F4CD}'; // 📍

function looksLikeTitle(s) {
  if (!s) return false;
  if (ONLY_URL_RE.test(s)) return false;
  if (ONLY_TIME_RE.test(s)) return false;
  return true;
}

// Parse un bloc texte WhatsApp en une liste d'evenements (un par jour trouve).
export function parseMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const events = [];
  let current = null;

  const push = () => {
    if (!current) return;
    // Regle metier : un event valide = un venue ET au moins une activite horaire.
    const hasRealVenue = current.venue && !ONLY_URL_RE.test(current.venue);
    const hasActivity = current.activities.length > 0;
    if (hasRealVenue && hasActivity) events.push(current);
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
      title = stripMarkdown(title);
      title = stripFillerPrefix(title);
      // Garde le titre uniquement s'il a l'air d'un vrai titre (pas un timestamp ou une URL).
      if (!looksLikeTitle(title)) title = '';
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
      const afterPin = stripFillerPrefix(stripMarkdown(line.split(PIN)[1].replace(/^[\s:]+/, '').trim()));
      if (afterPin) {
        if (ONLY_URL_RE.test(afterPin)) {
          // 📍 https://maps... = lien Maps du lieu, pas le nom du venue.
          current.mapUrl = afterPin;
        } else {
          current.venue = afterPin;
          // Le venue peut contenir l'URL en suffixe : on la separe.
          const urlIn = afterPin.match(URL_RE);
          if (urlIn) {
            current.venue = afterPin.replace(urlIn[0], '').replace(/[\s,;|]+$/, '').trim();
            current.mapUrl = current.mapUrl || urlIn[1];
          }
        }
      }
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

const ARTICLES = new Set(['the', 'la', 'el', 'le', 'les', 'los', 'las', 'a', 'an']);

// Cle venue normalisee : 1-2 tokens significatifs (sans article ni nombre),
// utilisee pour fusionner deux evenements qui referencent le meme lieu sous des noms differents.
// Ex : "the WAREHOUSE, AVENIDA 20..." et "The Warehouse" -> "warehouse".
export function venueKey(ev) {
  let v = ev.venue || '';
  if (ONLY_URL_RE.test(v)) v = '';
  if (!v && ev.title && !ONLY_URL_RE.test(ev.title) && !ONLY_TIME_RE.test(ev.title)) v = ev.title;
  if (!v) return null;
  v = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  v = v.split(/[,;:|()/]/)[0];
  const tokens = v
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t && !ARTICLES.has(t) && !/^\d+$/.test(t));
  if (!tokens.length) return null;
  return tokens.slice(0, 2).join('-');
}

// Identifiant stable d'un evenement (pour dedup / upsert).
export function eventId(ev) {
  const vk = venueKey(ev);
  if (vk) return `${ev.dayIndex}-${vk}`;
  const fallback = (ev.title || ev.day).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${ev.dayIndex}-${fallback}`;
}
