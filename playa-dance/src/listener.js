import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import { startListener } from './whatsapp.js';

// Entree LOCALE : affiche le QR dans le terminal.
startListener({
  onQr: (qr) => {
    console.log('\n📲 Scanne ce QR depuis WhatsApp > Appareils connectes :\n');
    qrcode.generate(qr, { small: true });
  },
});
