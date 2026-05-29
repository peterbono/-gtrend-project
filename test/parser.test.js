import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, eventId } from '../src/parser.js';

// Message reel reconstitue depuis les captures du groupe PDC Dance Socials.
const SAMPLE = `🔥 SEMANA DE BAILE EN PLAYA DEL CARMEN 🔥
(English below)

🌅 DOMINGO – Latin Sunset Party
✅ 5p Clase de Salsa
✅ 6p Clase de Bachata
✅ 7-11p Baile Social (Salsa/Bachata)
📍 Fiesta Inn (Av. 10 y C. 24)
https://share.google/abc123Domingo

💃 MARTES – Salsa & Bachata PDC Project
✅ 6p Clase de Salsa Lady Style
✅ 7p Clase de Salsa
✅ 8p Clase de Bachata
✅ 9-10p Práctica
📍 Mercado "De La Diez"
https://share.google/BJQU3R2yw6Msd9xTr

🔥 JUEVES – Salsa y Bachata PDC Project
✅ 6p Clase de Lady Style Bachata
✅ 7p Clase de Salsa
✅ 8p Clase de Bachata
✅ 9-10p Práctica
📍 SoHo Hotel Rooftop
https://share.google/SAXsOCosy1JUOCQ4d

🌟 VIERNES – LUSH Latin Dance Party
✅ 7p Clase de Salsa (Principiante Y Intermedio)
✅ 8p Clase de Bachata (Principiante Y Intermedio)
✅ 9p-1a Baile Social (Salsa/Bachata)
📍 The Warehouse
https://share.google/UgZg0bjptGw238Q4R`;

test('extrait 4 evenements (un par jour)', () => {
  const evs = parseMessage(SAMPLE);
  assert.equal(evs.length, 4);
  assert.deepEqual(evs.map((e) => e.day), ['DOMINGO', 'MARTES', 'JUEVES', 'VIERNES']);
});

test('jeudi: titre, lieu, url et horaires corrects', () => {
  const jueves = parseMessage(SAMPLE).find((e) => e.day === 'JUEVES');
  assert.equal(jueves.title, 'Salsa y Bachata PDC Project');
  assert.equal(jueves.venue, 'SoHo Hotel Rooftop');
  assert.equal(jueves.mapUrl, 'https://share.google/SAXsOCosy1JUOCQ4d');
  assert.equal(jueves.dayIndex, 4);
  assert.deepEqual(jueves.activities.map((a) => a.time), ['6p', '7p', '8p', '9-10p']);
  assert.equal(jueves.activities[1].name, 'Clase de Salsa');
});

test('plages horaires type 9p-1a et 7-11p', () => {
  const evs = parseMessage(SAMPLE);
  const viernes = evs.find((e) => e.day === 'VIERNES');
  assert.equal(viernes.activities.at(-1).time, '9p-1a');
  const domingo = evs.find((e) => e.day === 'DOMINGO');
  assert.equal(domingo.activities.at(-1).time, '7-11p');
});

test('eventId stable et unique par jour/lieu', () => {
  const evs = parseMessage(SAMPLE);
  const ids = evs.map(eventId);
  assert.equal(new Set(ids).size, 4);
});

test('texte sans jour -> aucun evenement', () => {
  assert.deepEqual(parseMessage('Hola a todos! Nos vemos pronto 💃'), []);
});
