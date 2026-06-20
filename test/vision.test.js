import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceEventArray, visionEnabled } from '../src/vision.js';

test('coerceEventArray: tableau direct', () => {
  assert.deepEqual(coerceEventArray([{ day: 'LUNES' }]), [{ day: 'LUNES' }]);
});

test('coerceEventArray: objet enveloppe {events:[...]}/{eventos:[...]}', () => {
  assert.deepEqual(coerceEventArray({ events: [{ day: 'MARTES' }] }), [{ day: 'MARTES' }]);
  assert.deepEqual(coerceEventArray({ eventos: [{ day: 'MARTES' }] }), [{ day: 'MARTES' }]);
});

test('coerceEventArray: objet event unique -> tableau', () => {
  assert.deepEqual(coerceEventArray({ day: 'SABADO', activities: [] }), [{ day: 'SABADO', activities: [] }]);
});

test('coerceEventArray: null / forme inconnue -> []', () => {
  assert.deepEqual(coerceEventArray(null), []);
  assert.deepEqual(coerceEventArray({ foo: 'bar' }), []);
  assert.deepEqual(coerceEventArray('nope'), []);
});

test('visionEnabled: vrai si Gemini OU OpenRouter present', () => {
  const g = process.env.GEMINI_API_KEY, o = process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY;
  assert.equal(visionEnabled(), false);
  process.env.OPENROUTER_API_KEY = 'x';
  assert.equal(visionEnabled(), true);
  if (g) process.env.GEMINI_API_KEY = g; else delete process.env.GEMINI_API_KEY;
  if (o) process.env.OPENROUTER_API_KEY = o; else delete process.env.OPENROUTER_API_KEY;
});
