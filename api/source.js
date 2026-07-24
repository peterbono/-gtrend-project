// Sert le texte brut original d'un event (source "text") en text/plain.
// Cote client : GET /api/source?id=<eventId>. On ne peut pas utiliser une
// data: URL pour ca : Chrome bloque la navigation target="_blank" vers une
// data: URL (mitigation anti-tabnabbing) -- le lien s'ouvrait sur un onglet
// vide. Une vraie URL same-origin contourne le blocage.
import { allEvents } from '../src/store.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const events = await allEvents();
  const ev = events.find((e) => e.id === id);
  if (!ev?.rawText) return res.status(404).json({ error: 'not found' });
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(ev.rawText);
}
