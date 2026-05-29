import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, eventsForDay } from './store.js';
import { DAY_LABEL_FR } from './days.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Jour courant selon l'heure de Playa del Carmen (UTC-5), peu importe le fuseau du serveur.
function playaDayIndex() {
  const now = new Date(Date.now() - 5 * 3600 * 1000);
  return now.getUTCDay();
}

export function createApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/today', async (req, res) => {
    const idx = playaDayIndex();
    res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: await eventsForDay(idx) });
  });

  app.get('/api/events', async (req, res) => {
    if (req.query.day !== undefined) {
      const idx = Number(req.query.day);
      return res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: await eventsForDay(idx) });
    }
    res.json({ days: DAY_LABEL_FR, events: await allEvents() });
  });

  return app;
}
