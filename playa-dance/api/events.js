import { allEvents, eventsForDay } from '../src/store.js';

const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export default async function handler(req, res) {
  const { day } = req.query;
  if (day !== undefined) {
    const idx = Number(day);
    return res.json({ dayIndex: idx, dayLabel: DAYS_FR[idx], events: await eventsForDay(idx) });
  }
  res.json({ days: DAYS_FR, events: await allEvents() });
}
