// Sert l'image brute d'un flyer capture par le scraper (source "vision").
// Cote client : GET /api/flyer?id=<msgId> (msgId = event.flyerUrl deja construit
// par allEvents()). 404 si le flyer n'a jamais ete capture ou a expire (TTL
// alignee sur la duree de vie de l'event, cf store.js).
import { getFlyerImage } from '../src/store.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const flyer = await getFlyerImage(String(id));
  if (!flyer) return res.status(404).json({ error: 'not found' });
  res.setHeader('content-type', flyer.mimetype || 'image/jpeg');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(Buffer.from(flyer.data, 'base64'));
}
