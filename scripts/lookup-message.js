import 'dotenv/config';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

// Lookup ponctuel : retrouve le texte brut d'un message WhatsApp source a
// partir du msgId stocke sur un event (voir store.js mergeEvent). Reutilise
// la session .wwebjs_auth restauree depuis le cache GH (meme session que le
// cron), en lecture seule : ne sauvegarde pas de nouveau cache.
//
// Usage (CI) : MSG_ID=<msg.id._serialized> node scripts/lookup-message.js

const MSG_ID = process.env.MSG_ID;
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_SECONDS || 90) * 1000;

if (!MSG_ID) {
  console.error('[lookup] MSG_ID manquant.');
  process.exit(1);
}

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
  console.log(`[lookup] shutdown (${reason})`);
  try {
    await client.destroy();
  } catch (err) {
    console.warn('[lookup] destroy error:', err.message);
  }
  setTimeout(() => process.exit(code), 1000);
}

const readyTimer = setTimeout(() => {
  console.error(`[lookup] timeout: pas de "ready" en ${READY_TIMEOUT_MS / 1000}s`);
  shutdown('ready-timeout', 1);
}, READY_TIMEOUT_MS);

client.on('qr', () => {
  console.error('[lookup] QR demande : session manquante/expiree. Lance le workflow Bootstrap avant de reessayer.');
  shutdown('qr-required', 75);
});

client.on('ready', async () => {
  clearTimeout(readyTimer);
  console.log(`[lookup] connecte, recherche du message ${MSG_ID}...`);
  try {
    const msg = await client.getMessageById(MSG_ID);
    if (!msg) {
      console.log('[lookup] Aucun message trouve pour cet id (trop ancien, ou hors du cache local WhatsApp Web).');
      return shutdown('not-found', 3);
    }
    const chat = await msg.getChat().catch(() => null);
    console.log('==================================================');
    console.log(`Groupe     : ${chat?.name || '(inconnu)'}`);
    console.log(`Auteur     : ${msg.author || msg.from || '(inconnu)'}`);
    console.log(`Date       : ${new Date((msg.timestamp || 0) * 1000).toISOString()}`);
    console.log(`Type       : ${msg.type}${msg.hasMedia ? ' (media)' : ''}`);
    console.log('--------------------------------------------------');
    console.log(msg.body || '(pas de texte -- probablement un flyer image)');
    console.log('==================================================');
    shutdown('done', 0);
  } catch (err) {
    console.error('[lookup] erreur :', err.message);
    shutdown('error', 1);
  }
});

client.on('disconnected', (reason) => console.warn('[lookup] disconnected:', reason));

console.log(`[lookup] init (recherche de ${MSG_ID})`);
client.initialize().catch((err) => {
  console.error('[lookup] init echouee :', err.message);
  shutdown('init-failed', 1);
});

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
