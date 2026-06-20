// Diagnostic one-shot : cherche "zouk"/"bachazouk" dans l'historique WhatsApp
// des groupes surveilles. Reutilise la session .wwebjs_auth restoree du cache.
// - TEXT MATCH : message dont le corps mentionne zouk.
// - FLYER : image dont la vision extrait un event (on flag samedi + mention zouk)
//   -> permet de voir si un flyer de demain a ete mal lu (zouk -> bachata).
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import { extractFromImage, visionEnabled } from '../src/vision.js';
import { findGroups, parseGroupNames } from '../src/group-match.js';

const { Client, LocalAuth } = pkg;

const GROUP_NAME = process.env.GROUP_NAME || 'PDC Dance Socials';
const HOURS = Number(process.env.SCAN_HOURS || 240);
const LIMIT = Number(process.env.SCAN_LIMIT || 1000);
const VISION_HOURS = Number(process.env.VISION_HOURS || 120); // flyers a relire (recents)
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_SECONDS || 240) * 1000;
const NEEDLE = /zouk|bachazouk|brazilian/i;

const cutoffMs = Date.now() - HOURS * 3600 * 1000;
const visionCutoffMs = Date.now() - VISION_HOURS * 3600 * 1000;

const puppeteer = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
if (process.env.PUPPETEER_EXECUTABLE_PATH) puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth' }),
  puppeteer,
});

let stopping = false;
async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`[find-zouk] shutdown (${reason})`);
  try { await client.destroy(); } catch (err) { console.warn('destroy:', err.message); }
  setTimeout(() => process.exit(code), 1500);
}

const readyTimer = setTimeout(() => shutdown('ready-timeout', 1), READY_TIMEOUT_MS);

client.on('qr', () => shutdown('qr-required', 75));

const ts = (m) => new Date((m.timestamp || 0) * 1000).toISOString();

client.on('ready', async () => {
  clearTimeout(readyTimer);
  const targets = parseGroupNames(GROUP_NAME);
  const chats = await client.getChats();
  const matched = findGroups(chats, GROUP_NAME);
  console.log(`✓ ${matched.length}/${targets.length} groupe(s) : ${matched.map((g) => `"${g.name}"`).join(', ')}`);

  let textHits = 0, flyerHits = 0, satFlyers = 0, totalMedia = 0, visionCalls = 0;

  for (const group of matched) {
    const messages = await group.fetchMessages({ limit: LIMIT });
    const recent = messages.filter((m) => (m.timestamp || 0) * 1000 >= cutoffMs);
    console.log(`\n📜 [${group.name}] ${recent.length}/${messages.length} msgs dans ${HOURS}h (oldest ${recent.length ? ts(recent[0]) : 'n/a'})`);

    for (const msg of recent) {
      // 1) Match texte direct
      if (NEEDLE.test(msg.body || '')) {
        textHits++;
        console.log(`\n🟢 TEXT MATCH ${ts(msg)} [${group.name}]`);
        console.log((msg.body || '').slice(0, 500));
      }
      // 2) Flyers images recents -> vision
      if (msg.hasMedia && (msg.timestamp || 0) * 1000 >= visionCutoffMs) {
        totalMedia++;
        try {
          const media = await msg.downloadMedia();
          if (media && media.mimetype?.startsWith('image/')) {
            visionCalls++;
            const events = await extractFromImage(media.data, media.mimetype);
            const blob = JSON.stringify(events).toLowerCase();
            const hasZouk = NEEDLE.test(blob);
            const sat = events.filter((e) => e.dayIndex === 6);
            if (hasZouk || sat.length) {
              flyerHits += hasZouk ? 1 : 0;
              satFlyers += sat.length ? 1 : 0;
              console.log(`\n🖼️  FLYER ${ts(msg)} [${group.name}] zouk=${hasZouk} samedi=${sat.length}`);
              events.forEach((e) => console.log(`    ${e.day} | "${e.title}" @ ${e.venue} :: ${(e.activities || []).map((a) => `${a.time} ${a.name}`).join(' | ')}`));
              if (msg.body) console.log(`    caption: ${msg.body.slice(0, 200)}`);
            }
          }
        } catch (err) { console.warn(`  ⚠️ media: ${err.message}`); }
      }
    }
  }

  console.log(`\n==== BILAN ==== textHits=${textHits} flyerZouk=${flyerHits} flyersSamedi=${satFlyers} mediaScannes=${totalMedia} visionCalls=${visionCalls}`);
  if (!textHits && !flyerHits) console.log('AUCUNE mention zouk/bachazouk dans le texte ni dans les flyers relus.');
  shutdown('done', 0);
});

console.log(`[find-zouk] init (cutoff ${new Date(cutoffMs).toISOString()}, vision depuis ${new Date(visionCutoffMs).toISOString()}, vision=${visionEnabled()})`);
client.initialize().catch((err) => shutdown('init-failed:' + err.message, 1));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
