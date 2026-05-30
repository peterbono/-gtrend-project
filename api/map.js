import { allEvents } from '../src/store.js';
import { geocodeVenue } from '../src/geocode.js';

export default async function handler(req, res) {
  const events = await allEvents();
  // Groupe par venue (cle normalisee : lowercase + 1er segment avant virgule)
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

  res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
  res.json({ venues, playaCenter: [20.6296, -87.0739] });
}
