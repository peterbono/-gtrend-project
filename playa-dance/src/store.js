import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventId } from './parser.js';

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

// Insere ou met a jour les evenements (dedup par id jour/lieu).
export async function upsertMany(events, meta = {}) {
  if (!events.length) return [];
  const map = await readMap();
  const now = new Date().toISOString();
  const saved = events.map((ev) => {
    const id = eventId(ev);
    const prev = map[id];
    map[id] = {
      id,
      ...ev,
      source: meta.source || prev?.source || 'text',
      firstSeen: prev?.firstSeen || now,
      lastSeen: now,
    };
    return map[id];
  });
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
