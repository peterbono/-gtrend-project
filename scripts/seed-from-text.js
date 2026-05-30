// One-off : seeder Upstash a partir de messages WhatsApp colles en dur.
// Pratique quand la session WhatsApp est rate-limitee et qu'on a deja les textes.
import 'dotenv/config';
import { parseMessage } from '../src/parser.js';
import { upsertMany } from '../src/store.js';

const MESSAGES = [
  // VIERNES — LUSH Latin Dance Party @ The Warehouse
  `VIERNES - LUSH Latin Dance Party

🕺🏽 19:00 h – Clases de salsa (Principiante e Intermedio)
💃🏻 20:00 h – Clases de bachata (Principiante e Intermedio)
✅ 21:00 h – Baile social
📍 The Warehouse, Av 20 entre 4 & 6
https://maps.app.goo.gl/fsMC1MRKXdkfbyez8`,

  // SABADO — Beach Paradise @ Coco Beach
  `SABADO - Beach Paradise Coco Beach

🗓️ SÁBADO, 30 de Mayo
17:00 - 19:30 Bachata Kizomba Salsa Social
💵 Cooperación voluntaria
📍 Coco Beach
https://maps.app.goo.gl/4e9Q2VPq61Wf75xx6`,

  // SABADO — Bachata Soul Rooftop, Tulum centro
  `SABADO - Bachata Soul Rooftop

Este Sábado de Bachata, Timba & Cumbia en TULUM centro
Clase con CHINA & GON, Música por DJ TORRES

20:00 Clase de Bachata con China & Gon
22:00 Baile Social Bachata Timba Cumbia
📍 Rooftop Bar Tulum Centro`,

  // SABADO — Dance Alchemy @ Callejón del Arte
  `SABADO - Dance Alchemy

Beyond Styles. Explore the Movement!
Every Saturday

11:00 - 13:00 Open Movement Session
📍 Callejón del Arte, 6 bis entre 10 y 15
https://maps.app.goo.gl/ApF3Q8E9KGSFDRc68`,

  // DOMINGO — Tango Brigante 1er anniversaire @ Hyatt Centric
  `DOMINGO - Tango Brigante 1er aniversario

Este domingo 31 de mayo celebramos 1 año de tango en Playa.
Rifa con regalos, zapatos de tango.
Dress code: Elegant Tango Vibes.

17:30 - Clase de Tango
18:30 - Milonga
📍 Hyatt Centric Playa del Carmen – Alessya Rooftop, Calle Corazón
https://maps.app.goo.gl/e3gmffqsz3UrS7gY6`,

  // DOMINGO — Latin Breeze Sunday @ MEXCALLI
  // Note : Le message dit "2 clases al mismo tiempo" — donc 2 profs paralleles
  // par creneau. On les expose comme activites distinctes.
  `DOMINGO - Latin Breeze Sunday

La fiesta latina más grande de la Riviera Maya llega a MEXCALLI
Salsa, Bachata, Social Dance Internacional.
Ambiente elegante, buena vibra.

19:00 Clase de Salsa Beginner
19:00 Clase de Salsa Intermediate/Advanced
20:00 Clase de Bachata Beginner
20:00 Clase de Bachata Intermediate/Advanced
21:00 Social Dance
📍 Mexcalli, 5th Ave btw 4th & 6th St, Playa del Carmen`,
];

console.log(`[seed] parsing ${MESSAGES.length} messages...`);
let totalEvents = 0;
for (const msg of MESSAGES) {
  const events = parseMessage(msg);
  for (const ev of events) {
    console.log(`  • [${ev.day}] ${ev.title || '(no title)'} @ ${ev.venue} (${ev.activities.length} activities)`);
    for (const a of ev.activities) {
      console.log(`      ${a.time} ${a.name}`);
    }
  }
  if (events.length) {
    await upsertMany(events, { source: 'manual-seed' });
    totalEvents += events.length;
  } else {
    console.log(`  ⚠ no event parsed from: ${msg.slice(0, 80)}...`);
  }
}
console.log(`[seed] DONE: ${totalEvents} events upserted to Upstash.`);
process.exit(0);
