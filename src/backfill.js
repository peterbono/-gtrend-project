// One-shot : fetch les N dernieres heures de messages dans le groupe et upsert
// dans le store. Reutilise la session .wwebjs_auth restoree depuis le cache GH.
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import { parseMessage } from './parser.js';
import { upsertMany, storageMode } from './store.js';
import { extractFromImage, visionEnabled } from './vision.js';

const { Client, LocalAuth } = pkg;

const GROUP_NAME = process.env.GROUP_NAME || 'PDC Dance Socials';
const HOURS = Number(process.env.BACKFILL_HOURS || 24);
const LIMIT = Number(process.env.BACKFILL_LIMIT || 200);
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_SECONDS || 90) * 1000;

const cutoffMs = Date.now() - HOURS * 3600 * 1000;

const puppeteer = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth' }),
  puppeteer,
});

let stopping = false;
async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`[backfill] shutdown (${reason})`);
  try {
    await client.destroy();
  } catch (err) {
    console.warn('[backfill] destroy error:', err.message);
  }
  setTimeout(() => process.exit(code), 1500);
}

const readyTimer = setTimeout(() => {
  console.error(`[backfill] timeout: pas de "ready" en ${READY_TIMEOUT_MS / 1000}s`);
  shutdown('ready-timeout', 1);
}, READY_TIMEOUT_MS);

client.on('qr', () => {
  console.error('[backfill] QR demande : session manquante ou expiree dans le cache.');
  shutdown('qr-required', 2);
});

client.on('ready', async () => {
  clearTimeout(readyTimer);
  console.log(`🚀 Connecte, recherche du groupe "${GROUP_NAME}"...`);
  console.log(`   Stockage : ${storageMode} | Vision : ${visionEnabled() ? 'ACTIVEE' : 'desactivee'}`);

  try {
    const chats = await client.getChats();
    const group = chats.find((c) => c.isGroup && c.name === GROUP_NAME);
    if (!group) {
      console.error(`Groupe "${GROUP_NAME}" introuvable parmi ${chats.length} chats.`);
      return shutdown('group-not-found', 3);
    }

    console.log(`📜 Fetch les ${LIMIT} derniers messages...`);
    const messages = await group.fetchMessages({ limit: LIMIT });
    const recent = messages.filter((m) => (m.timestamp || 0) * 1000 >= cutoffMs);
    console.log(`Traitement : ${recent.length} / ${messages.length} messages dans les ${HOURS}h.`);

    let captured = 0;
    let visionCalls = 0;
    for (const msg of recent) {
      try {
        let events = parseMessage(msg.body || '');
        let source = 'text';

        if (events.length === 0 && msg.hasMedia && visionEnabled()) {
          const media = await msg.downloadMedia();
          if (media && media.mimetype?.startsWith('image/')) {
            events = await extractFromImage(media.data, media.mimetype);
            source = 'vision';
            visionCalls += 1;
          }
        }

        if (events.length) {
          await upsertMany(events, { source });
          captured += events.length;
          console.log(`  📥 ${events.length} [${source}] : ${events.map((e) => e.day).join(', ')}`);
        }
      } catch (err) {
        console.warn(`  ⚠️  ${err.message}`);
      }
    }

    console.log(`✅ Backfill termine : ${captured} evenement(s) upsert, ${visionCalls} appels vision.`);
    shutdown('done', 0);
  } catch (err) {
    console.error('[backfill] erreur :', err.message);
    shutdown('error', 1);
  }
});

client.on('disconnected', (reason) => {
  console.warn('[backfill] disconnected:', reason);
});

console.log(`[backfill] init (cutoff: ${new Date(cutoffMs).toISOString()})`);
client.initialize().catch((err) => {
  console.error('[backfill] init echouee :', err.message);
  shutdown('init-failed', 1);
});

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
