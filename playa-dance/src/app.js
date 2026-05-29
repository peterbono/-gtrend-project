import 'dotenv/config';
import QRCode from 'qrcode';
import { createApp } from './web.js';
import { startListener } from './whatsapp.js';
import { storageMode } from './store.js';

// Entree CLOUD : un seul process = web app + listener WhatsApp + QR servi sur /qr.
// Ideal pour Railway / Render / VPS (toujours allume, scan du QR depuis le navigateur).
const PORT = process.env.PORT || 3000;

let qrDataUrl = null;
let ready = false;

const app = createApp();

// Page de liaison : affiche le QR a scanner avec le telephone.
app.get('/qr', (req, res) => {
  res.set('content-type', 'text/html; charset=utf-8');
  if (ready) {
    return res.send('<body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ WhatsApp connecté</h2><p>L\'écoute tourne. Tu peux fermer cette page.</p><p><a href="/">Voir les soirées →</a></p></body>');
  }
  if (!qrDataUrl) {
    return res.send('<head><meta http-equiv="refresh" content="2"></head><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>⏳ Génération du QR…</h2></body>');
  }
  res.send(`<head><meta http-equiv="refresh" content="20"></head>
<body style="font-family:sans-serif;text-align:center;padding:32px">
  <h2>📲 Scanne avec WhatsApp &gt; Appareils connectés</h2>
  <img src="${qrDataUrl}" width="320" height="320" alt="QR WhatsApp" />
  <p style="color:#888">La page se rafraîchit toute seule. Le QR change toutes les ~20 s.</p>
</body>`);
});

app.listen(PORT, () => {
  console.log(`🌴 Web app : http://localhost:${PORT}`);
  console.log(`📲 Liaison WhatsApp : http://localhost:${PORT}/qr  (stockage : ${storageMode})`);
});

startListener({
  onQr: async (qr) => {
    qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
    console.log('📲 QR prêt — ouvre /qr dans le navigateur pour scanner.');
  },
  onReady: () => {
    ready = true;
    qrDataUrl = null;
  },
});
