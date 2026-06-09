import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTime, mergeActivities, isFreshEvent } from '../src/store.js';

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
