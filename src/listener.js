import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import { startListener } from './whatsapp.js';

// Entree LOCALE : affiche le QR (ou le code de liaison si LINK_PHONE est defini).
startListener({
  onQr: (qr) => {
    console.log('\n📲 Scanne ce QR depuis WhatsApp > Appareils connectes :\n');
    qrcode.generate(qr, { small: true });
  },
  onPairingCode: (code) => {
    console.log(`\n📲 Code de liaison (WhatsApp > Appareils connectes > Lier avec numero) : ${code}\n`);
  },
});
