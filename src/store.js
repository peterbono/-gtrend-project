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

// Fraicheur : un event qui n'a pas ete revu depuis ce nombre de jours est
// considere comme ponctuel (one-off) et n'est plus servi par allEvents().
// Les events hebdomadaires recurrents sont re-vus chaque semaine, donc jamais filtres.
const MAX_EVENT_AGE_DAYS = 10;

// Fraicheur PAR ACTIVITE : une activite jamais revue depuis ce nombre de jours
// est droppee a la lecture. Le bug prod : un vieux flyer (classes 5p/6p) et le
// post courant (19:00/20:00) coexistent dans le meme event car mergeActivities
// dedupe par (heure|style|niveau) — la meme classe a une autre heure passe a
// travers et ne meurt jamais. Le TTL par activite laisse mourir l'ancien horaire.
const MAX_ACTIVITY_AGE_DAYS = 14;

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

// Hook test/dev : PLAYA_DATA_FILE force le mode fichier local (jamais defini
// en prod), ce qui permet aux tests d'ecrire dans un fichier temporaire sans
// risquer de toucher Redis ni data/events.json.
function dataFile() {
  return process.env.PLAYA_DATA_FILE || FILE;
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function readMap() {
  if (useRedis && !process.env.PLAYA_DATA_FILE) return (await (await redis()).get(KEY)) || {};
  return loadFile();
}

async function writeMap(map) {
  if (useRedis && !process.env.PLAYA_DATA_FILE) return void (await (await redis()).set(KEY, map));
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(map, null, 2));
}

// Un titre prefixe par une date ponctuelle ("13th June Cubanisimo...", "20 de
// junio ...", "June 13 ...") ne doit PAS gagner sur un titre recurrent propre :
// l'app est une vue hebdomadaire, un meme lieu/jour cumule plusieurs dates.
const DATE_TITLE_RE = /^\s*(?:\d{1,2}(?:st|nd|rd|th)\b|\d{1,2}\s+de\s+\p{L}+|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago|dic)\w*\.?\s+\d{1,2}\b)/iu;

// Heuristique : entre deux valeurs candidates pour title/venue, garde la plus informative.
export function better(a, b) {
  const score = (s) => {
    if (!s) return 0;
    if (/^https?:\/\//i.test(s)) return -1;
    if (/^\s*\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?\s*$/.test(s)) return -1;
    // Titre date-prefixe : tres bas (au-dessus de vide/url, sous tout vrai titre).
    if (DATE_TITLE_RE.test(s)) return 1;
    return s.length;
  };
  return score(b) > score(a) ? b : a;
}

// Normalise une heure vers le format 24h "HH:MM" pour dedup cross-locale.
// "5pm" -> "17:00", "17:30" -> "17:30", "5:30pm" -> "17:30", "9am" -> "09:00".
// "7-11PM" -> "19:00" (le PM en fin de plage propage au debut sans marqueur).
// Gere aussi les formes collees ("11PM", "8p"), avec points ("8:00p.m.") et
// les plages qui traversent minuit ("9-1am" -> 21:00) ou midi ("11-1pm" -> 11:00).
// NB : pas de \b entre un chiffre et "pm" (les deux sont des word chars),
// d'ou le pattern explicite ([ap])\.?\s*m?\.? qui matche colle OU detache.
const MERIDIEM_PART = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?/;
export function normTime(t) {
  const s = (t || '').toLowerCase().trim();
  const parts = s.split(/[-–]/);
  const startPart = parts[0].trim();
  const endPart = parts.slice(1).join('-').trim();
  const m = startPart.match(MERIDIEM_PART);
  if (!m || !m[1]) return s;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  let ap = m[3];
  // Si le debut n'a pas d'am/pm, on le deduit de la fin de plage : "7-11PM" -> p.
  if (!ap && endPart) {
    const endM = endPart.match(MERIDIEM_PART);
    if (endM && endM[3]) {
      const endAp = endM[3];
      const endH = Number(endM[1]);
      if (endAp === 'a') {
        // "9-1am" traverse minuit -> le debut est en soiree (pm).
        ap = endH <= h && h !== 12 ? 'p' : 'a';
      } else {
        // "11-1pm" traverse midi -> le debut est le matin (am). "7-11pm" -> pm.
        ap = endH < h && h !== 12 ? 'a' : 'p';
      }
    }
  }
  if (ap === 'p' && h < 12) h += 12;
  else if (ap === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Stop-words : on les ignore pour comparer 2 activites (ils n'apportent pas
// d'info distinguante : tout le monde a une "class").
const TOKEN_STOP = new Set([
  'class', 'classes', 'clase', 'clases', 'lesson', 'lessons', 'workshop',
  'workshops', 'taller', 'talleres', 'cours', 'session', 'sessions', 'time',
  'same', 'with', 'and', 'con',
]);

// Synonymes cross-langue : "principiante" et "beginner" doivent compter
// comme le meme token pour dedup les versions ES/EN d'une activite.
const TOKEN_SYN = {
  principiante: 'beg', principiantes: 'beg', beginner: 'beg', beginners: 'beg', beg: 'beg',
  intermedio: 'int', intermedios: 'int', intermediate: 'int', int: 'int',
  avanzado: 'adv', avanzados: 'adv', advanced: 'adv', adv: 'adv',
  baile: 'social', social: 'social', party: 'social',
  practica: 'practice', practicar: 'practice', practice: 'practice',
};

function nameTokens(s) {
  return new Set(
    (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TOKEN_STOP.has(w))
      .map((w) => TOKEN_SYN[w] || w.replace(/s$/, ''))
  );
}
function isSubsetOrEqual(small, big) {
  const a = nameTokens(small.name);
  const b = nameTokens(big.name);
  // Set vide (= nom 100% filler / stop-words) -> considere comme subset de
  // n'importe quel non-vide a la meme heure (drop par mergeActivities).
  if (a.size === 0 && b.size > 0) return true;
  if (a.size === 0) return false;
  for (const w of a) if (!b.has(w)) return false;
  return true;
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

// Entre deux timestamps lastSeen, garde le plus recent. Defensif : si l'un
// est absent/illisible on garde l'autre ; si les deux sont absents -> null
// (withSeen n'ajoutera alors pas de cle).
function laterSeen(a, b) {
  const ta = Date.parse(a || '');
  const tb = Date.parse(b || '');
  if (Number.isNaN(ta) && Number.isNaN(tb)) return a || b || null;
  if (Number.isNaN(tb)) return a;
  if (Number.isNaN(ta)) return b;
  return tb > ta ? b : a;
}

// Attache un lastSeen a une activite SANS jamais creer de cle undefined
// (les activites legacy sans lastSeen restent sans la cle).
function withSeen(act, seen) {
  return seen ? { ...act, lastSeen: seen } : act;
}

export function mergeActivities(a = [], b = []) {
  const all = [...(a || []), ...(b || [])];
  const out = [];
  const seenSocialStarts = new Map();
  const seenWorkshops = new Map();
  const seenSemantic = new Map();

  for (const act of all) {
    if (isSocialAct(act)) {
      const startNorm = normTime(act.time);
      if (seenSocialStarts.has(startNorm)) {
        const idx = seenSocialStarts.get(startNorm);
        const prev = out[idx];
        const time = (act.time || '').length > (prev.time || '').length ? act.time : prev.time;
        const name = (act.name || '').length > (prev.name || '').length ? act.name : prev.name;
        // Un duplicat = la meme activite revue -> on rafraichit son lastSeen.
        out[idx] = withSeen({ time, name }, laterSeen(prev.lastSeen, act.lastSeen));
        continue;
      }
      out.push(act);
      seenSocialStarts.set(startNorm, out.length - 1);
      continue;
    }
    const exactKey = `${normTime(act.time)}|${(act.name || '').toLowerCase().trim().replace(/\s+/g, ' ')}`;
    if (seenWorkshops.has(exactKey)) {
      const idx = seenWorkshops.get(exactKey);
      out[idx] = withSeen(out[idx], laterSeen(out[idx].lastSeen, act.lastSeen));
      continue;
    }
    const semKey = styleLevelKey(act);
    if (semKey && seenSemantic.has(semKey)) {
      const idx = seenSemantic.get(semKey);
      const keep = (act.name || '').length > (out[idx].name || '').length ? act : out[idx];
      out[idx] = withSeen(keep, laterSeen(out[idx].lastSeen, act.lastSeen));
      continue;
    }
    out.push(act);
    seenWorkshops.set(exactKey, out.length - 1);
    if (semKey) seenSemantic.set(semKey, out.length - 1);
  }

  // Pass finale : dedup par chevauchement de tokens semantiques a la meme heure.
  // - Si une activite a un set de tokens egal ou subset d'une autre -> on garde
  //   la plus informative (= la plus longue).
  // - Tokens normalises (synonymes ES/EN, stop-words ignores) : "Clases de Salsa
  //   Principiante e Intermedio" et "Salsa Class Beginner & Intermediate"
  //   fusionnent en une seule entree.
  const cleaned = [];
  for (const a of out) {
    const tA = normTime(a.time);
    let drop = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (normTime(c.time) !== tA) continue;
      const aSubC = isSubsetOrEqual(a, c);
      const cSubA = isSubsetOrEqual(c, a);
      if (aSubC && cSubA) {
        // sets equivalents -> garde le name le plus long, lastSeen le plus recent.
        const keep = (a.name || '').length > (c.name || '').length ? a : c;
        cleaned[i] = withSeen(keep, laterSeen(a.lastSeen, c.lastSeen));
        drop = true;
        break;
      }
      // a domine -> drop a (mais c vient d'etre revu -> refresh)
      if (aSubC) { cleaned[i] = withSeen(c, laterSeen(a.lastSeen, c.lastSeen)); drop = true; break; }
      // c domine -> a remplace c
      if (cSubA) { cleaned[i] = withSeen(a, laterSeen(a.lastSeen, c.lastSeen)); drop = true; break; }
    }
    if (!drop) cleaned.push(a);
  }
  return cleaned;
}

// Cle de fusion par titre : le meme event reel poste sous deux orthographes de
// lieu ("the WAREHOUSE, AVENIDA 20..." vs "the WAREHOUSE Av. 5 y C. 10") cree
// deux entries car venueKey diverge — mais le titre exact est partage
// ("LUSH Latin Dance Party"). On fusionne par (dayIndex, titre normalise),
// UNIQUEMENT si le titre est assez specifique (>= 3 mots ou >= 15 caracteres) :
// deux venues differentes qui postent un generique "Salsa night" ne doivent
// PAS fusionner. Titre vide/absent -> jamais de fusion (retourne null).
export function titleMergeKey(ev) {
  const t = (ev?.title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accent-fold : "Fiesta Cubaña" -> "cubana"
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ') // strip ponctuation : "party!" == "party"
    .replace(/\b(y|and)\b/g, ' ') // "Salsa y Bachata" == "Salsa & Bachata" == "Salsa and Bachata"
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (t.split(' ').length < 3 && t.length < 15) return null; // trop generique
  return `${ev.dayIndex}|${t}`;
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
// Index secondaire par (dayIndex, titre normalise specifique) : le meme event reel
// poste avec une orthographe de lieu differente (venueKey divergent) atterrit
// quand meme sur l'entry existante au lieu d'en creer une deuxieme.
export async function upsertMany(events, meta = {}) {
  if (!events.length) return [];
  const map = await readMap();
  const now = new Date().toISOString();

  // Index secondaires : (dayIndex, venueKey) -> id, puis (dayIndex, titre) -> id.
  const byVenue = new Map();
  const byTitle = new Map();
  for (const [id, ev] of Object.entries(map)) {
    const vk = venueKey(ev);
    if (vk) byVenue.set(`${ev.dayIndex}|${vk}`, id);
    const tk = titleMergeKey(ev);
    if (tk) byTitle.set(tk, id);
  }

  const saved = [];
  for (const ev of events) {
    const vk = venueKey(ev);
    const venueIdx = vk ? `${ev.dayIndex}|${vk}` : null;
    const titleIdx = titleMergeKey(ev);
    const candidateId =
      (venueIdx && byVenue.get(venueIdx)) || (titleIdx && byTitle.get(titleIdx)) || eventId(ev);
    const prev = map[candidateId];

    // Chaque activite vue dans le message entrant est estampillee lastSeen = now ;
    // une activite deja en store garde son propre lastSeen (refresh uniquement si
    // un duplicat entrant la matche, via laterSeen dans mergeActivities).
    const incomingActs = (ev.activities || []).map((a) => ({ ...a, lastSeen: now }));

    if (prev) {
      // Backfill des activites legacy sans lastSeen : on leur donne le lastSeen
      // de l'EVENT (= derniere fois ou elles ont pu etre vues). C'est ce qui
      // permet aux vieux horaires de s'eteindre au fil des upserts futurs.
      const prevActs = (prev.activities || []).map((a) =>
        a.lastSeen ? a : withSeen(a, prev.lastSeen || now)
      );
      const merged = mergeEvent({ ...prev, activities: prevActs }, { ...ev, activities: incomingActs }, meta);
      map[candidateId] = {
        ...merged,
        id: candidateId,
        firstSeen: prev.firstSeen || now,
        lastSeen: now,
      };
    } else {
      // Pas de prev mais on dedupe quand meme les activites entre elles
      // (le parser peut en produire 2 versions ES/EN d'un meme creneau).
      map[candidateId] = {
        id: candidateId,
        ...ev,
        activities: mergeActivities(incomingActs, []),
        source: meta.source || 'text',
        firstSeen: now,
        lastSeen: now,
      };
      if (venueIdx) byVenue.set(venueIdx, candidateId);
      if (titleIdx) byTitle.set(titleIdx, candidateId);
    }
    saved.push(map[candidateId]);
  }

  await writeMap(map);
  return saved;
}

// Filtre de fraicheur : drop les events ponctuels jamais revus depuis
// MAX_EVENT_AGE_DAYS. Defensif : lastSeen absent ou illisible -> on garde.
export function isFreshEvent(ev, now = Date.now()) {
  if (!ev?.lastSeen) return true;
  const seen = Date.parse(ev.lastSeen);
  if (Number.isNaN(seen)) return true;
  return now - seen <= MAX_EVENT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

// Filtre de zone : l'app couvre Playa del Carmen uniquement, mais le groupe
// WhatsApp relaie parfois des events d'autres villes (Tulum, Cancun...).
// VOLONTAIREMENT CONSERVATEUR : on ne droppe que les references EXPLICITES a
// une autre ville. Un match nu sur /tulum/ ou /cancun/ serait faux :
// - les adresses de Playa contiennent "Carretera Cancun-Tulum km ..." ;
// - un resto de Playa s'appelle "La Fonda de la Tulum".
// Dans le doute, on GARDE l'event (pire cas : un point en trop sur la carte,
// que le bounding-box de api/map.js attrapera s'il est geocode hors zone).
const OTHER_CITY_RES = [
  /\btulum\s+centro\b/,
  /\bdowntown\s+tulum\b/,
  /\btulum\s+downtown\b/,
  /\ben\s+tulum\b/,
  /\btulum\s*,\s*q/, // "Tulum, Q. Roo" / "Tulum, Quintana Roo"
  /\bcancun\b(?!\s*[-–]\s*tulum)/, // mais pas l'axe routier "Cancun-Tulum"
  /\bcozumel\b/,
  /\bakumal\b/,
  /\bpuerto\s+aventuras\b/,
  /\bpuerto\s+morelos\b/,
  /\bholbox\b/,
  /\bbacalar\b/,
  /\bmerida\b/,
  /\bvalladolid\b/,
];
function mentionsOtherCity(s) {
  if (!s) return false;
  const t = String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // cancún -> cancun, mérida -> merida
    // Les segments "Carretera ..." sont des adresses de Playa (Carretera
    // Cancun-Tulum, Carretera a Cancun...) : on les neutralise avant le test.
    .replace(/\bcarretera[^,;]*/g, ' ');
  return OTHER_CITY_RES.some((re) => re.test(t));
}
export function isInScope(ev) {
  return !mentionsOtherCity(ev?.venue) && !mentionsOtherCity(ev?.title);
}

// Fraicheur par activite : un vieil horaire (flyer perime) jamais reconfirme
// depuis MAX_ACTIVITY_AGE_DAYS disparait, meme si l'event reste actif via
// d'autres creneaux. Defensif : une activite sans lastSeen herite du lastSeen
// de l'EVENT (donc les donnees legacy sont gardees aujourd'hui et s'eteignent
// au fil des upserts futurs) ; rien d'exploitable -> on garde.
export function isFreshActivity(act, eventLastSeen, now = Date.now()) {
  const stamp = act?.lastSeen || eventLastSeen;
  const seen = Date.parse(stamp || '');
  if (Number.isNaN(seen)) return true;
  return now - seen <= MAX_ACTIVITY_AGE_DAYS * 24 * 60 * 60 * 1000;
}

// Fusion A LA LECTURE des events de meme (jour, titre specifique) : repare les
// donnees DEJA stockees en double (meme event poste sous deux orthographes de
// lieu -> deux entries car venueKey diverge). Pas de reecriture du store, le
// fix s'applique instantanement aux donnees existantes. Le plus recemment vu
// sert de base (venue/mapUrl/price), les activites du groupe sont unionnees.
export function mergeByTitle(events) {
  const groups = new Map();
  const passthrough = [];
  for (const ev of events) {
    const k = titleMergeKey(ev);
    if (!k) { passthrough.push(ev); continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(ev);
  }
  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const sorted = group.slice().sort(
      (a, b) => (Date.parse(b.lastSeen || '') || 0) - (Date.parse(a.lastSeen || '') || 0)
    );
    const base = sorted[0];
    const activities = sorted.reduce((acc, ev) => mergeActivities(acc, ev.activities || []), []);
    merged.push({ ...base, activities });
  }
  return [...merged, ...passthrough];
}

export async function allEvents() {
  const map = await readMap();
  const now = Date.now();
  const events = Object.values(map)
    .filter((ev) => isFreshEvent(ev, now) && isInScope(ev))
    .map((ev) => ({
      ...ev,
      activities: (ev.activities || []).filter((a) => isFreshActivity(a, ev.lastSeen, now)),
    }))
    .filter((ev) => (ev.activities || []).length > 0);
  return mergeByTitle(events).sort((a, b) => a.dayIndex - b.dayIndex);
}

export async function eventsForDay(dayIndex) {
  return (await allEvents()).filter((e) => e.dayIndex === dayIndex);
}

export const storageMode = useRedis ? 'redis' : 'local-json';
