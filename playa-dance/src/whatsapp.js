import pkg from 'whatsapp-web.js';
import { parseMessage } from './parser.js';
import { upsertMany, storageMode } from './store.js';
import { extractFromImage, visionEnabled } from './vision.js';

const { Client, LocalAuth } = pkg;

// Demarre l'ecoute WhatsApp. Callbacks optionnels : onQr(qr), onReady().
export function startListener({ onQr, onReady } = {}) {
  const GROUP_NAME = process.env.GROUP_NAME || 'PDC Dance Socials';

  const puppeteer = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth' }),
    puppeteer,
  });

  client.on('qr', (qr) => onQr?.(qr));
  client.on('authenticated', () => console.log('✅ Authentifie. Session sauvegardee.'));
  client.on('ready', () => {
    console.log(`🚀 Connecte. J'ecoute le groupe : "${GROUP_NAME}"`);
    console.log(`   Stockage : ${storageMode}${storageMode === 'redis' ? ' (lien public live)' : ''}`);
    console.log(`   Vision flyers : ${visionEnabled() ? 'ACTIVEE' : 'desactivee (texte seul)'}`);
    onReady?.();
  });

  async function handle(msg) {
    try {
      const chat = await msg.getChat();
      if (!chat.isGroup || chat.name !== GROUP_NAME) return;

      let events = parseMessage(msg.body || '');
      let source = 'text';

      if (events.length === 0 && msg.hasMedia && visionEnabled()) {
        const media = await msg.downloadMedia();
        if (media && media.mimetype?.startsWith('image/')) {
          events = await extractFromImage(media.data, media.mimetype);
          source = 'vision';
        }
      }

      if (events.length) {
        await upsertMany(events, { source });
        console.log(`📥 ${events.length} evenement(s) [${source}] : ${events.map((e) => e.day).join(', ')}`);
      }
    } catch (err) {
      console.error('Erreur traitement message :', err.message);
    }
  }

  client.on('message', handle);
  client.on('message_create', (m) => { if (m.fromMe) handle(m); });

  // Init resiliente : une erreur (reseau, coupure) ne tue pas le process.
  // Indispensable pour un hebergement 24/7.
  const init = () => {
    client.initialize().catch(async (err) => {
      console.error('Init WhatsApp echouee, nouvelle tentative dans 15s :', err.message);
      try { await client.destroy(); } catch { /* ferme le navigateur reste ouvert */ }
      setTimeout(init, 15000);
    });
  };
  client.on('disconnected', (reason) => {
    console.warn('WhatsApp deconnecte :', reason, '— reconnexion dans 5s…');
    setTimeout(init, 5000);
  });
  init();

  return client;
}
