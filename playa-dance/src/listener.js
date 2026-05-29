import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { parseMessage } from './parser.js';
import { upsertMany } from './store.js';
import { extractFromImage, visionEnabled } from './vision.js';

const { Client, LocalAuth } = pkg;
const GROUP_NAME = process.env.GROUP_NAME || 'PDC Dance Socials';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', (qr) => {
  console.log('\n📲 Scanne ce QR code depuis WhatsApp > Appareils connectes :\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Authentifie. Session sauvegardee.'));
client.on('ready', () => {
  console.log(`🚀 Connecte. J'ecoute le groupe : "${GROUP_NAME}"`);
  console.log(`   Vision flyers : ${visionEnabled() ? 'ACTIVEE' : 'desactivee (texte seul)'}`);
});

async function handle(msg) {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup || chat.name !== GROUP_NAME) return;

    // 1) Parsing texte (gratuit, prioritaire)
    let events = parseMessage(msg.body || '');
    let source = 'text';

    // 2) Secours vision : que si pas d'event texte ET message avec image
    if (events.length === 0 && msg.hasMedia && visionEnabled()) {
      const media = await msg.downloadMedia();
      if (media && media.mimetype?.startsWith('image/')) {
        events = await extractFromImage(media.data, media.mimetype);
        source = 'vision';
      }
    }

    if (events.length) {
      upsertMany(events, { source });
      console.log(`📥 ${events.length} evenement(s) capte(s) [${source}] : ${events.map((e) => e.day).join(', ')}`);
    }
  } catch (err) {
    console.error('Erreur traitement message :', err.message);
  }
}

client.on('message', handle);
client.on('message_create', (m) => { if (m.fromMe) handle(m); });

client.initialize();
