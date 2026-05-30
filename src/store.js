import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventId, venueKey } from './parser.js';

// Stockage unifie, utilise par le listener, le serveur local ET les fonctions Vercel.
// - Si Upstash Redis est configure (UPSTASH_REDIS_REST_URL) -> stockage partage,
//   ce qui rend le lien Vercel LIVE (le listener ecrit, l'app lit).
// - Sinon -> fichier local data/events.json (mode 100% local, aucun compte requis).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'events.json');
const KEY = 'playa:events';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

let _redis;
async function redis() {
  if (_redis) return _redis;
  const { Redis } = await import('@upstash/redis');
  _redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  return _redis;
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function readMap() {
  if (useRedis) return (await (await redis()).get(KEY)) || {};
  return loadFile();
}

async function writeMap(map) {
  if (useRedis) return void (await (await redis()).set(KEY, map));
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

// Heuristique : entre deux valeurs candidates pour title/venue, garde la plus informative.
function better(a, b) {
  const score = (s) => {
    if (!s) return 0;
    if (/^https?:\/\//i.test(s)) return -1;
    if (/^\s*\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?\s*$/.test(s)) return -1;
    return s.length;
  };
  return score(b) > score(a) ? b : a;
}

// Normalise une heure pour comparaison : "9pm" -> "9p", "9:00pm" -> "9p", "9 p.m" -> "9p"
function normTime(t) {
  return (t || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/:00\b/g, '')
    .replace(/p\.?m\.?/g, 'p')
    .replace(/a\.?m\.?/g, 'a');
}
function isSocialAct(a) {
  return /\b(social|baile|party)\b/i.test(a?.name || '');
}
// Heure de debut (en nombre brut, sans ampm normalise — suffit pour matcher "9pm" et "9p-1a").
function timeStart(t) {
  const m = (t || '').toLowerCase().match(/^(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

// Cle semantique : meme heure + meme style + meme niveau = duplicat (FR/EN/ES).
// "Clases de Salsa Principiante 19:00" == "Salsa Classes Beginner 19:00".
const STYLE_RE_S = /\b(salsa|bachata|kizomba|zouk|merengue|tango|cha[\s-]?cha)\b/i;
const LEVEL_MAP = {
  beginner: 'beg', beg: 'beg',
  principiante: 'beg', principiantes: 'beg',
  debutant: 'beg', débutant: 'beg', debutants: 'beg',
  intermediate: 'int', int: 'int',
  intermedio: 'int', intermedios: 'int',
  advanced: 'adv', adv: 'adv',
  avanzado: 'adv', avanzados: 'adv',
};
function styleLevelKey(act) {
  const name = (act?.name || '').toLowerCase();
  const styleM = name.match(STYLE_RE_S);
  const style = styleM ? styleM[1].toLowerCase().replace(/\s/g, '') : '';
  if (!style) return null;
  // Cherche un mot de niveau dans le nom
  let level = '';
  for (const word of name.split(/[\s,();\-–]+/)) {
    if (LEVEL_MAP[word]) { level = LEVEL_MAP[word]; break; }
  }
  return `${normTime(act.time)}|${style}|${level}`;
}

function mergeActivities(a = [], b = []) {
  const all = [...(a || []), ...(b || [])];
  const out = [];
  const seenSocialStarts = new Map();
  const seenWorkshops = new Map();    // cle exacte time|name → idx
  const seenSemantic = new Map();     // cle time|style|level → idx (dedup FR/EN)

  for (const act of all) {
    if (isSocialAct(act)) {
      const start = timeStart(act.time);
      if (start != null && seenSocialStarts.has(start)) {
        const idx = seenSocialStarts.get(start);
        const prev = out[idx];
        const time = (act.time || '').length > (prev.time || '').length ? act.time : prev.time;
        const name = (act.name || '').length > (prev.name || '').length ? act.name : prev.name;
        out[idx] = { time, name };
        continue;
      }
      out.push(act);
      if (start != null) seenSocialStarts.set(start, out.length - 1);
      continue;
    }
    // Workshop : dedup exact + dedup semantique.
    const exactKey = `${normTime(act.time)}|${(act.name || '').toLowerCase().trim().replace(/\s+/g, ' ')}`;
    if (seenWorkshops.has(exactKey)) continue;
    const semKey = styleLevelKey(act);
    if (semKey && seenSemantic.has(semKey)) {
      // Garde le nom le plus long (souvent plus informatif).
      const idx = seenSemantic.get(semKey);
      if ((act.name || '').length > (out[idx].name || '').length) {
        out[idx] = act;
      }
      continue;
    }
    out.push(act);
    seenWorkshops.set(exactKey, out.length - 1);
    if (semKey) seenSemantic.set(semKey, out.length - 1);
  }
  return out;
}

function mergeEvent(prev, incoming, meta) {
  return {
    ...prev,
    title: better(prev.title, incoming.title),
    venue: better(prev.venue, incoming.venue),
    mapUrl: prev.mapUrl || incoming.mapUrl || null,
    price: prev.price || incoming.price || null,
    activities: mergeActivities(prev.activities, incoming.activities),
    source: prev.source === 'vision' || meta.source === 'vision' ? 'vision' : (prev.source || meta.source || 'text'),
  };
}

// Insere ou met a jour les evenements. Dedup par (dayIndex, venueKey) : deux messages
// referencant le meme lieu sous des noms differents se fusionnent en un seul event.
export async function upsertMany(events, meta = {}) {
  if (!events.length) return [];
  const map = await readMap();
  const now = new Date().toISOString();

  // Index secondaire : (dayIndex, venueKey) -> id existant.
  const byVenue = new Map();
  for (const [id, ev] of Object.entries(map)) {
    const vk = venueKey(ev);
    if (vk) byVenue.set(`${ev.dayIndex}|${vk}`, id);
  }

  const saved = [];
  for (const ev of events) {
    const vk = venueKey(ev);
    const venueIdx = vk ? `${ev.dayIndex}|${vk}` : null;
    const candidateId = (venueIdx && byVenue.get(venueIdx)) || eventId(ev);
    const prev = map[candidateId];

    if (prev) {
      const merged = mergeEvent(prev, ev, meta);
      map[candidateId] = {
        ...merged,
        id: candidateId,
        firstSeen: prev.firstSeen || now,
        lastSeen: now,
      };
    } else {
      map[candidateId] = {
        id: candidateId,
        ...ev,
        source: meta.source || 'text',
        firstSeen: now,
        lastSeen: now,
      };
      if (venueIdx) byVenue.set(venueIdx, candidateId);
    }
    saved.push(map[candidateId]);
  }

  await writeMap(map);
  return saved;
}

export async function allEvents() {
  const map = await readMap();
  return Object.values(map).sort((a, b) => a.dayIndex - b.dayIndex);
}

export async function eventsForDay(dayIndex) {
  return (await allEvents()).filter((e) => e.dayIndex === dayIndex);
}

export const storageMode = useRedis ? 'redis' : 'local-json';
