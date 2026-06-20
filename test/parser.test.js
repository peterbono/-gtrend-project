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

// ── mapUrl : restreint aux domaines cartes ───────────────────────────────────

test('un lien non-maps (Instagram, linkfly) ne devient jamais mapUrl', () => {
  const msg = `LUNES – Salsa Night
8p Clase de Salsa
📍 On Stage
https://www.instagram.com/onstageplaya
https://linkfly.to/onstage`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.venue, 'On Stage');
  assert.equal(ev.mapUrl, null);
});

test('lien maps prioritaire meme si un lien non-maps est present', () => {
  const msg = `LUNES – Salsa Night
8p Clase de Salsa
📍 On Stage
https://www.instagram.com/onstageplaya
https://maps.app.goo.gl/2kazpa7CvQ9hQAkt8`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.mapUrl, 'https://maps.app.goo.gl/2kazpa7CvQ9hQAkt8');
});

test('lien maps sans protocole apres 📍 -> mapUrl, pas un nom de venue', () => {
  const msg = `MARTES – Bachata Social
9p Baile Social
📍 maps.app.goo.gl/2kazpa7CvQ9hQAkt8
📍 La Fe Restaurante`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.mapUrl, 'https://maps.app.goo.gl/2kazpa7CvQ9hQAkt8');
  assert.equal(ev.venue, 'La Fe Restaurante');
});

test('domaines maps varies acceptes (google.com/maps, waze, share.google)', () => {
  for (const link of [
    'https://www.google.com/maps/place/On+Stage',
    'https://goo.gl/maps/abc123',
    'https://maps.google.com/?q=on+stage',
    'https://waze.com/ul/h9sx4u',
    'https://share.google/SAXsOCosy1JUOCQ4d',
  ]) {
    const [ev] = parseMessage(`LUNES – Test\n8p Clase\n📍 On Stage\n${link}`);
    assert.equal(ev.mapUrl, link, `mapUrl devrait accepter ${link}`);
  }
});

// ── TIME_RE : meridiem pointe "8:00p.m." ─────────────────────────────────────

test('heure "8:00p.m." ne laisse pas ".m." dans le nom d\'activite', () => {
  const msg = `MIERCOLES – Salsa On1
8:00p.m. Salsa On1
9:30 P.M. Bachata Sensual
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.deepEqual(ev.activities.map((a) => a.name), ['Salsa On1', 'Bachata Sensual']);
  assert.equal(ev.activities[0].time, '8:00p.m.');
});

// ── stripLead / stripFillerPrefix ────────────────────────────────────────────

test('fleches "→" et pipes "|" en tete de ligne sont strippes', () => {
  const msg = `JUEVES – Social
→ 8p Clase de Salsa
| 9p Baile Social
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.deepEqual(ev.activities.map((a) => a.name), ['Clase de Salsa', 'Baile Social']);
});

test('prefixes "¿Dónde?" et "Nos vemos en" strippes du venue', () => {
  const cases = [
    ['📍 ¿Dónde? Fiesta Inn', 'Fiesta Inn'],
    ['📍 ¿Donde? Fiesta Inn', 'Fiesta Inn'],
    ['📍 Nos vemos en Fiesta Inn', 'Fiesta Inn'],
  ];
  for (const [pinLine, expected] of cases) {
    const [ev] = parseMessage(`VIERNES – Social\n8p Clase\n${pinLine}`);
    assert.equal(ev.venue, expected, `venue pour "${pinLine}"`);
  }
});

// ── promos / heures impossibles : ne pas creer d'activite bidon ──────────────

test('"50% Discount for locals ‼️" -> price/promo, PAS une activite "50:00"', () => {
  const msg = `VIERNES – LUSH Latin Dance Party
9p Clase de Salsa
50% Discount for locals ‼️
📍 The Warehouse`;
  const [ev] = parseMessage(msg);
  // L'activite "50:00 % Discount..." ne doit pas exister.
  assert.deepEqual(ev.activities.map((a) => a.time), ['9p']);
  assert.ok(!ev.activities.some((a) => /Discount/i.test(a.name)), 'pas de promo en activite');
  // La promo est capturee dans price, libelle nettoye (sans ‼️).
  assert.equal(ev.price, '50% Discount for locals');
});

test('"2x1 drinks" n\'est pas une activite "2:00"', () => {
  const msg = `SABADO – Bachata Night
9p Baile Social
2x1 drinks
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.deepEqual(ev.activities.map((a) => a.time), ['9p']);
  assert.ok(!ev.activities.some((a) => /drinks/i.test(a.name)));
  assert.equal(ev.price, '2x1 drinks');
});

test('heure impossible "50:00 foo" rejetee (pas d\'activite)', () => {
  const msg = `LUNES – Social
50:00 foo
8p Clase de Salsa
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.deepEqual(ev.activities.map((a) => a.time), ['8p']);
  assert.ok(!ev.activities.some((a) => /foo/i.test(a.name)));
});

test('promo ne remplace pas un vrai prix deja capture ($200 MXN)', () => {
  const msg = `VIERNES – Social
9p Clase de Salsa
$200 MXN
50% Discount for locals
📍 The Warehouse`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.price, '$200 MXN');
  assert.deepEqual(ev.activities.map((a) => a.time), ['9p']);
});

test('regression: "21:00", "8pm", "9-1am" restent des activites horaires', () => {
  const msg = `MIERCOLES – Salsa On1
21:00 Salsa class
8pm Bachata
9-1am Baile Social
07-08 PM Warmup
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.deepEqual(ev.activities.map((a) => a.time), ['21:00', '8pm', '9-1am', '07-08pm']);
  assert.equal(ev.activities[0].name, 'Salsa class');
});

test('regression: "19:00 Salsa class" devient bien une activite', () => {
  const msg = `JUEVES – Social
19:00 Salsa class
📍 On Stage`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.activities.length, 1);
  assert.equal(ev.activities[0].time, '19:00');
  assert.equal(ev.activities[0].name, 'Salsa class');
});

test('temps: separateur point "8.15pm" garde minutes et nom propre', () => {
  const msg = `MARTES
📍 Mercado
8.15pm La Natico & Orlando`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.activities.length, 1);
  assert.equal(ev.activities[0].time, '8.15pm');
  assert.equal(ev.activities[0].name, 'La Natico & Orlando');
});

test('temps: duree "1.30 hs de clase" n\'est PAS lue comme une heure', () => {
  const msg = `LUNES – Taller
📍 On Stage
1.30 hs de clase de bachata
8pm Clase de Bachata`;
  const [ev] = parseMessage(msg);
  // Seul "8pm" est une activite ; la duree ne cree pas un faux cours a 1:30.
  assert.deepEqual(ev.activities.map((a) => a.time), ['8pm']);
});

test('venue: label "Zona:/Lugar:" sans 📍 alimente le venue', () => {
  const msg = `SABADO – Fiesta
Zona: ZAZIL-HA
9pm Social`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.venue, 'ZAZIL-HA');
});

test('workshop sans heure: lieu + titre synthetisent une activite sans heure', () => {
  const msg = `*PRÓXIMO SÁBADO❤️‍🔥 WORKSHOP DE BACHAZOUK✨*
🩵 SÁBADO 20 de junio
🩵 Zona: ZAZIL-HA
🩵 $250 Méx`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.dayIndex, 6);
  assert.equal(ev.venue, 'ZAZIL-HA');
  assert.equal(ev.title, 'WORKSHOP DE BACHAZOUK');
  assert.equal(ev.activities.length, 1);
  assert.equal(ev.activities[0].time, '');
  assert.match(ev.activities[0].name, /BACHAZOUK/);
});

test('jour anglais: "Monday" cree bien un bloc (jour 1)', () => {
  const msg = `Monday Night Party
📍 Maui
9pm Social`;
  const [ev] = parseMessage(msg);
  assert.equal(ev.dayIndex, 1);
});

test('garde-fou: event jour+lieu SANS titre ni heure reste jete (pas de bruit)', () => {
  const msg = `VIERNES
📍 Some Venue`;
  assert.equal(parseMessage(msg).length, 0);
});
