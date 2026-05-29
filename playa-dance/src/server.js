import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, eventsForDay } from './store.js';
import { DAY_LABEL_FR } from './days.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// Soirees d'aujourd'hui (timezone serveur).
app.get('/api/today', (req, res) => {
  const idx = new Date().getDay();
  res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: eventsForDay(idx) });
});

// Soirees d'un jour precis (?day=0..6) ou toute la semaine.
app.get('/api/events', (req, res) => {
  if (req.query.day !== undefined) {
    const idx = Number(req.query.day);
    return res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: eventsForDay(idx) });
  }
  res.json({ days: DAY_LABEL_FR, events: allEvents() });
});

app.listen(PORT, () => {
  console.log(`🌴 Web app sur http://localhost:${PORT}`);
});
