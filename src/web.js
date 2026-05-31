import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, eventsForDay } from './store.js';
import { geocodeVenue, geocodeManyViaGemini } from './geocode.js';
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
    const nonEmpty = (e) => e.activities && e.activities.length > 0;
    if (req.query.day !== undefined) {
      const idx = Number(req.query.day);
      return res.json({ dayIndex: idx, dayLabel: DAY_LABEL_FR[idx], events: (await eventsForDay(idx)).filter(nonEmpty) });
    }
    res.json({ days: DAY_LABEL_FR, events: (await allEvents()).filter(nonEmpty) });
  });

  app.get('/api/map', async (req, res) => res.json(await buildMapPayload()));

  app.get('/api/route', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });
    const [lat1, lon1] = String(from).split(',').map(Number);
    const [lat2, lon2] = String(to).split(',').map(Number);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return res.status(400).json({ error: 'invalid' });
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/foot/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`, { headers: { 'User-Agent': 'playa-dance/1.0' } });
      if (!r.ok) return res.status(502).json({ error: 'osrm' });
      const data = await r.json();
      const route = data?.routes?.[0];
      if (!route) return res.json({ ok: false });
      res.setHeader('cache-control', 'public, max-age=3600');
      res.json({ ok: true, distanceMeters: route.distance, durationSeconds: route.duration, geometry: route.geometry });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return app;
}

// Construit la payload /api/map en utilisant le batch Gemini pour les venues non cachees.
async function buildMapPayload() {
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

  // Premier passe : KNOWN + mapUrl + Nominatim cache hit (rapide, pas de quota).
  const venues = [];
  const missing = [];
  for (const v of byVenue.values()) {
    let geo = null;
    try { geo = await geocodeVenue(v.displayName, v.mapUrl); } catch { /* ignore */ }
    if (geo?.found) {
      venues.push({ ...v, lat: geo.lat, lon: geo.lon, geocoded: true });
    } else {
      missing.push(v);
    }
  }

  // Deuxieme passe : batch Gemini pour les venues sans coords.
  if (missing.length) {
    const batch = await geocodeManyViaGemini(missing.map((v) => v.displayName));
    for (const v of missing) {
      const geo = batch.get(v.displayName);
      venues.push({ ...v, lat: geo?.lat ?? null, lon: geo?.lon ?? null, geocoded: !!geo });
    }
  }

  return { venues, playaCenter: [20.6296, -87.0739] };
}

export { buildMapPayload };
