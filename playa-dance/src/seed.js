// Remplit la base avec un message reel (reconstitue des captures) pour pouvoir
// tester la web app SANS connecter WhatsApp. Passe par le vrai parser.
import { parseMessage } from './parser.js';
import { upsertMany, allEvents } from './store.js';

const SAMPLE = `🔥 SEMANA DE BAILE EN PLAYA DEL CARMEN 🔥

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

const events = parseMessage(SAMPLE);
upsertMany(events, { source: 'seed' });
console.log(`✅ Base remplie avec ${events.length} evenements de demo.`);
console.log(allEvents().map((e) => `  - ${e.day} : ${e.title} @ ${e.venue}`).join('\n'));
