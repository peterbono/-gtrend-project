import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, eventsForDay, storageMode } from './store.js';
import { DAY_LABEL_FR } from './days.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/today', async (req, res) => {
  const idx = new Date().getDay();
  res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: await eventsForDay(idx) });
});

app.get('/api/events', async (req, res) => {
  if (req.query.day !== undefined) {
    const idx = Number(req.query.day);
    return res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: await eventsForDay(idx) });
  }
  res.json({ days: DAY_LABEL_FR, events: await allEvents() });
});

app.listen(PORT, () => {
  console.log(`🌴 Web app sur http://localhost:${PORT}  (stockage : ${storageMode})`);
});
