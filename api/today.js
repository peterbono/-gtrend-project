import { eventsForDay } from '../src/store.js';

const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export default async function handler(req, res) {
  // Jour selon l'heure de Playa del Carmen (UTC-5).
  const now = new Date(Date.now() - 5 * 3600 * 1000);
  const idx = now.getUTCDay();
  res.json({ dayIndex: idx, dayLabel: DAYS_FR[idx], events: await eventsForDay(idx) });
}
