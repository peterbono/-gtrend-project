import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventId } from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'events.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(map) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

// Insere ou met a jour un evenement. Conserve la 1ere apparition, rafraichit le reste.
export function upsertEvent(ev, meta = {}) {
  const map = load();
  const id = eventId(ev);
  const now = new Date().toISOString();
  const prev = map[id];
  map[id] = {
    id,
    ...ev,
    source: meta.source || prev?.source || 'text',
    firstSeen: prev?.firstSeen || now,
    lastSeen: now,
  };
  save(map);
  return map[id];
}

export function upsertMany(events, meta) {
  return events.map((e) => upsertEvent(e, meta));
}

export function allEvents() {
  return Object.values(load()).sort((a, b) => a.dayIndex - b.dayIndex);
}

export function eventsForDay(dayIndex) {
  return allEvents().filter((e) => e.dayIndex === dayIndex);
}
