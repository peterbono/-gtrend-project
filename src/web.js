import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, eventsForDay } from './store.js';
import { geocodeVenue } from './geocode.js';
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

  app.get('/api/map', async (req, res) => {
    const events = await allEvents();
    const byVenue = new Map();
    for (const ev of events) {
      const raw = (ev.venue || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase().split(',')[0].replace(/^\s*(the|la|el|le)\s+/, '').trim();
      if (!key) continue;
      if (!byVenue.has(key)) {
        byVenue.set(key, { venueKey: key, displayName: raw, mapUrl: ev.mapUrl || null, events: [] });
      }
      byVenue.get(key).events.push({ id: ev.id, dayIndex: ev.dayIndex, title: ev.title });
    }
    const venues = [];
    for (const v of byVenue.values()) {
      let geo = null;
      try { geo = await geocodeVenue(v.displayName, v.mapUrl); } catch { /* ignore */ }
      venues.push({
        venueKey: v.venueKey,
        displayName: v.displayName,
        mapUrl: v.mapUrl,
        events: v.events,
        lat: geo?.lat ?? null,
        lon: geo?.lon ?? null,
        geocoded: !!geo?.found,
      });
    }
    res.json({ venues, playaCenter: [20.6296, -87.0739] });
  });

  return app;
}
