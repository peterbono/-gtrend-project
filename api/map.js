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

  // Boite englobante Playa del Carmen : un venue geocode hors zone (Tulum,
  // Cancun...) ne doit jamais atterrir sur la carte. On remet lat/lon a null :
  // le client filtre deja les venues sans coords.
  const inPlayaBox = (lat, lon) => lat >= 20.55 && lat <= 20.72 && lon >= -87.15 && lon <= -86.98;

  const venues = [];
  for (const v of byVenue.values()) {
    let geo = null;
    try { geo = await geocodeVenue(v.displayName, v.mapUrl); } catch { /* ignore */ }
    let lat = geo?.lat ?? null;
    let lon = geo?.lon ?? null;
    let geocoded = !!geo?.found;
    if (lat != null && lon != null && !inPlayaBox(lat, lon)) {
      lat = null;
      lon = null;
      geocoded = false;
    }
    venues.push({
      venueKey: v.venueKey,
      displayName: v.displayName,
      mapUrl: v.mapUrl,
      events: v.events,
      lat,
      lon,
      geocoded,
    });
  }

  res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
  res.json({ venues, playaCenter: [20.6296, -87.0739] });
}
