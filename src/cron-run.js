import 'dotenv/config';
import { startListener } from './whatsapp.js';

// Entree CRON (GitHub Actions): connecte le listener, ecoute pendant une fenetre fixe,
// puis quitte proprement pour que LocalAuth flush la session sur disque.
//
// Variables :
//   RUN_DURATION_SECONDS  duree d'ecoute apres "ready" (defaut 480 = 8 min)
//   READY_TIMEOUT_SECONDS attente max du "ready" apres init (defaut 90)

const RUN_DURATION_MS = Number(process.env.RUN_DURATION_SECONDS || 480) * 1000;
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_SECONDS || 90) * 1000;
const ALLOW_LINK = process.env.ALLOW_LINK === '1';

// Code de sortie sentinel : "la session WhatsApp a expire, re-link requis".
// Distinct d'un vrai crash (1) pour que le workflow CI ne marque pas le run en
// echec rouge a chaque heure pour un etat attendu — il ouvre une alerte a la place.
const EXIT_RELINK_REQUIRED = 75;

let client = null;
let stopping = false;

async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`[cron] shutdown (${reason})`);
  try {
    if (client) await client.destroy();
  } catch (err) {
    console.warn('[cron] destroy error:', err.message);
  }
  // Petite marge pour le flush disque de LocalAuth.
  setTimeout(() => process.exit(code), 1500);
}

const readyTimer = setTimeout(() => {
  console.error(`[cron] timeout: pas de "ready" en ${READY_TIMEOUT_MS / 1000}s, on abandonne ce run`);
  shutdown('ready-timeout', 1);
}, READY_TIMEOUT_MS);

client = startListener({
  onQr: () => {
    if (ALLOW_LINK) {
      console.error('[cron] QR emis mais inscannable en CI. Definis LINK_PHONE pour utiliser le code de liaison.');
    } else {
      console.error('[cron] QR demande : pas d\'auth interactive en CI.');
      console.error('[cron] Bootstrap : lancer le workflow "bootstrap" avec LINK_PHONE.');
    }
    shutdown('qr-required', EXIT_RELINK_REQUIRED);
  },
  onPairingCode: (code) => {
    if (ALLOW_LINK) {
      console.log('==================================================');
      console.log(`  CODE DE LIAISON WHATSAPP : ${code}`);
      console.log('  Dans WhatsApp > Reglages > Appareils connectes > Lier un appareil > Lier avec numero, saisis ce code.');
      console.log('==================================================');
      // On laisse tourner jusqu'a ready ou ready-timeout.
      return;
    }
    console.error(`[cron] code de liaison emis (${code}) hors mode bootstrap : on quitte.`);
    shutdown('pairing-required', EXIT_RELINK_REQUIRED);
  },
  onReady: () => {
    clearTimeout(readyTimer);
    console.log(`[cron] ready, ecoute pendant ${RUN_DURATION_MS / 1000}s`);
    setTimeout(() => shutdown('window-elapsed', 0), RUN_DURATION_MS);
  },
});

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
