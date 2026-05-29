import 'dotenv/config';
import QRCode from 'qrcode';
import { createApp } from './web.js';
import { startListener } from './whatsapp.js';
import { storageMode } from './store.js';

// Entree CLOUD : un seul process = web app + listener WhatsApp + QR servi sur /qr.
// Ideal pour Railway / Render / VPS (toujours allume, scan du QR depuis le navigateur).
const PORT = process.env.PORT || 3000;

let qrDataUrl = null;
let pairingCode = null;
let ready = false;

const app = createApp();

// Page de liaison : code telephone (mobile) OU QR a scanner.
app.get('/qr', (req, res) => {
  res.set('content-type', 'text/html; charset=utf-8');
  const wrap = (inner) =>
    `<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"></head><body style="font-family:sans-serif;text-align:center;padding:32px;background:#0f1021;color:#f4f4fb">${inner}</body>`;

  if (ready) {
    return res.send(wrap('<h2>✅ WhatsApp connecté</h2><p>L\'écoute tourne. Tu peux fermer cette page.</p><p><a style="color:#ffd23d" href="/">Voir les soirées →</a></p>'));
  }
  if (pairingCode) {
    return res.send(wrap(`<h2>📲 Lier sans QR</h2>
      <p>Dans WhatsApp : <b>Réglages → Appareils connectés → Lier un appareil → Lier avec le numéro de téléphone</b>, puis saisis ce code :</p>
      <div style="font-size:2.4rem;letter-spacing:.3rem;font-weight:800;color:#ffd23d;margin:18px 0">${pairingCode}</div>
      <p style="color:#888">Le code se renouvelle si tu attends trop. La page se rafraîchit seule.</p>`));
  }
  if (qrDataUrl) {
    return res.send(wrap(`<h2>📲 Scanne avec WhatsApp &gt; Appareils connectés</h2>
      <img src="${qrDataUrl}" width="300" height="300" style="background:#fff;border-radius:12px" alt="QR WhatsApp" />
      <p style="color:#888">Le QR change toutes les ~20 s. La page se rafraîchit seule.</p>`));
  }
  res.send(wrap('<h2>⏳ Connexion à WhatsApp…</h2>'));
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
  onPairingCode: (code) => {
    pairingCode = code;
    console.log(`📲 Code de liaison WhatsApp : ${code}  (ouvre /qr)`);
  },
  onReady: () => {
    ready = true;
    qrDataUrl = null;
    pairingCode = null;
  },
});
