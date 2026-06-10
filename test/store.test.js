import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTime, mergeActivities, isFreshEvent, isInScope, isFreshActivity, mergeByTitle, titleMergeKey } from '../src/store.js';

// ── normTime : meridiem colle, plages, points ────────────────────────────────

test('normTime: am/pm colle aux chiffres (pas de word boundary)', () => {
  assert.equal(normTime('11PM'), '23:00');
  assert.equal(normTime('8p'), '20:00');
  assert.equal(normTime('9am'), '09:00');
  assert.equal(normTime('5:30pm'), '17:30');
});

test('normTime: le meridiem en fin de plage propage au debut', () => {
  // Le bug prod : "7-11PM" donnait 07:00 alors que "7p-11p" donnait 19:00,
  // d'ou des cles de dedup divergentes et des activites en double.
  assert.equal(normTime('7-11PM'), '19:00');
  assert.equal(normTime('7p-11p'), '19:00');
  assert.equal(normTime('7-11p'), '19:00');
  assert.equal(normTime('07-08 PM'), '19:00');
  assert.equal(normTime('8:30PM-9:30PM'), '20:30');
});

test('normTime: plage traversant minuit ou midi', () => {
  // "9-1am" = 21:00 -> 01:00 (le "am" de fin n'est PAS celui du debut).
  assert.equal(normTime('9-1am'), '21:00');
  assert.equal(normTime('9p-1a'), '21:00');
  // "5-9am" ne traverse pas minuit -> matin.
  assert.equal(normTime('5-9am'), '05:00');
  // "11-1pm" traverse midi -> 11:00 du matin.
  assert.equal(normTime('11-1pm'), '11:00');
});

test('normTime: formes pointees a.m./p.m.', () => {
  assert.equal(normTime('8:00p.m.'), '20:00');
  assert.equal(normTime('8:00 P.M.'), '20:00');
  assert.equal(normTime('9 a.m.'), '09:00');
  assert.equal(normTime('7-11 p.m.'), '19:00');
});

test('normTime: 24h et formats sans meridiem inchanges', () => {
  assert.equal(normTime('17:30'), '17:30');
  assert.equal(normTime('21:00'), '21:00');
  assert.equal(normTime('7'), '07:00');
  assert.equal(normTime(''), '');
});

// ── mergeActivities : dedup cross-format ─────────────────────────────────────

test('mergeActivities: "7-11PM" et "7p-11p" fusionnent (bug Clase de Bachata x4)', () => {
  const merged = mergeActivities(
    [{ time: '7-11PM', name: 'Clase de Bachata' }],
    [{ time: '7p-11p', name: 'Clase de Bachata' }]
  );
  assert.equal(merged.length, 1);
});

test('mergeActivities: "8:30PM-9:30PM" et "8:30p" fusionnent', () => {
  const merged = mergeActivities(
    [{ time: '8:30PM-9:30PM', name: 'Salsa On1' }],
    [{ time: '8:30p', name: 'Salsa On1' }]
  );
  assert.equal(merged.length, 1);
});

test('mergeActivities: heures differentes restent distinctes', () => {
  const merged = mergeActivities(
    [{ time: '7p', name: 'Clase de Bachata' }],
    [{ time: '8p', name: 'Clase de Bachata' }]
  );
  assert.equal(merged.length, 2);
});

// ── isFreshEvent : TTL des events ponctuels ──────────────────────────────────

test('isFreshEvent: event revu recemment -> garde', () => {
  const now = Date.parse('2026-06-09T12:00:00Z');
  assert.equal(isFreshEvent({ lastSeen: '2026-06-06T00:00:00Z' }, now), true);
});

test('isFreshEvent: event jamais revu depuis 10+ jours -> drop', () => {
  const now = Date.parse('2026-06-09T12:00:00Z');
  assert.equal(isFreshEvent({ lastSeen: '2026-05-20T00:00:00Z' }, now), false);
});

test('isFreshEvent: defensif si lastSeen absent ou illisible -> garde', () => {
  assert.equal(isFreshEvent({}), true);
  assert.equal(isFreshEvent({ lastSeen: null }), true);
  assert.equal(isFreshEvent({ lastSeen: 'pas-une-date' }), true);
});

// ── isInScope : filtre de zone Playa del Carmen (conservateur) ───────────────
// Le bug prod : "Rooftop Bar Tulum Centro" (un event a Tulum) etait geocode
// DANS Playa par Nominatim/LLM bornes a la zone. On droppe au niveau du store,
// mais uniquement sur des references EXPLICITES a une autre ville.

test('isInScope: "Rooftop Bar Tulum Centro" -> drop (autre ville explicite)', () => {
  assert.equal(isInScope({ venue: 'Rooftop Bar Tulum Centro', title: 'Salsa Social' }), false);
});

test('isInScope: "La Fonda de la Tulum" -> garde (resto de Playa, tulum nu)', () => {
  assert.equal(isInScope({ venue: 'La Fonda de la Tulum', title: 'Bachata Night' }), true);
});

test('isInScope: "Carretera Cancún-Tulum km 296" -> garde (adresse de Playa)', () => {
  assert.equal(isInScope({ venue: 'Carretera Cancún-Tulum km 296', title: 'Kizomba' }), true);
});

test('isInScope: autres villes explicites -> drop (venue ou title)', () => {
  assert.equal(isInScope({ venue: 'Mandala Cancún', title: 'Salsa' }), false);
  assert.equal(isInScope({ venue: 'Beach Club', title: 'Social en Tulum este sabado' }), false);
  assert.equal(isInScope({ venue: 'Zocalo, Tulum, Q. Roo', title: 'Salsa' }), false);
  assert.equal(isInScope({ venue: 'Rooftop Puerto Aventuras', title: 'Bachata' }), false);
  assert.equal(isInScope({ venue: 'Centro, Mérida', title: 'Salsa' }), false);
});

test('isInScope: defensif sur event vide ou sans venue/title', () => {
  assert.equal(isInScope({}), true);
  assert.equal(isInScope({ venue: null, title: null }), true);
  assert.equal(isInScope(undefined), true);
});

// ── isFreshActivity : fraicheur par activite ─────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

test('isFreshActivity: activite vue il y a < 14j -> garde', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  const recent = new Date(now - 5 * DAY).toISOString();
  assert.equal(isFreshActivity({ time: '9p', lastSeen: recent }, null, now), true);
});

test('isFreshActivity: activite vue il y a > 14j -> drop', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  const old = new Date(now - 20 * DAY).toISOString();
  assert.equal(isFreshActivity({ time: '9p', lastSeen: old }, null, now), false);
});

test('isFreshActivity: sans lastSeen propre -> herite du lastSeen de l\'event', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  const recentEvent = new Date(now - 2 * DAY).toISOString();
  const oldEvent = new Date(now - 30 * DAY).toISOString();
  // legacy activite (pas de lastSeen) : suit l'event.
  assert.equal(isFreshActivity({ time: '9p' }, recentEvent, now), true);
  assert.equal(isFreshActivity({ time: '9p' }, oldEvent, now), false);
});

test('isFreshActivity: defensif si aucune date exploitable -> garde', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  assert.equal(isFreshActivity({ time: '9p' }, null, now), true);
  assert.equal(isFreshActivity({ time: '9p', lastSeen: 'nope' }, 'nope', now), true);
});

// ── mergeByTitle : fusion read-time des cards jumelles ───────────────────────

test('mergeByTitle: meme jour + titre specifique -> une seule entry, venue la plus recente gagne', () => {
  const events = [
    { id: 'a', dayIndex: 5, title: 'LUSH Latin Dance Party', venue: 'the WAREHOUSE Av. 5 y C. 10',
      lastSeen: '2026-06-08T00:00:00Z', mapUrl: null,
      activities: [{ time: '7p', name: 'Salsa Class' }] },
    { id: 'b', dayIndex: 5, title: 'LUSH  Latin Dance Party!', venue: 'the WAREHOUSE, AVENIDA 20',
      lastSeen: '2026-06-09T00:00:00Z', mapUrl: 'https://maps.example/x',
      activities: [{ time: '9PM-1AM', name: 'Social Dancing' }] },
  ];
  const out = mergeByTitle(events);
  assert.equal(out.length, 1);
  // la version la plus recente (b) sert de base : venue + mapUrl gagnent.
  assert.equal(out[0].venue, 'the WAREHOUSE, AVENIDA 20');
  assert.equal(out[0].mapUrl, 'https://maps.example/x');
  // activites des deux entries unionnees.
  assert.equal(out[0].activities.length, 2);
});

test('mergeByTitle: titre generique court -> NE fusionne PAS deux venues', () => {
  const events = [
    { id: 'a', dayIndex: 5, title: 'Salsa night', venue: 'Bar A', lastSeen: '2026-06-08T00:00:00Z', activities: [{ time: '9p', name: 'x' }] },
    { id: 'b', dayIndex: 5, title: 'Salsa night', venue: 'Bar B', lastSeen: '2026-06-09T00:00:00Z', activities: [{ time: '9p', name: 'y' }] },
  ];
  assert.equal(titleMergeKey(events[0]), null); // 2 mots, < 15 chars
  assert.equal(mergeByTitle(events).length, 2);
});

test('mergeByTitle: jours differents ne fusionnent pas malgre meme titre', () => {
  const events = [
    { id: 'a', dayIndex: 4, title: 'LUSH Latin Dance Party', venue: 'X', lastSeen: '2026-06-08T00:00:00Z', activities: [{ time: '9p', name: 'x' }] },
    { id: 'b', dayIndex: 5, title: 'LUSH Latin Dance Party', venue: 'Y', lastSeen: '2026-06-09T00:00:00Z', activities: [{ time: '9p', name: 'y' }] },
  ];
  assert.equal(mergeByTitle(events).length, 2);
});
