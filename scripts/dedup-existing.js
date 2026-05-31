// One-off : re-passe le contenu d'Upstash a travers le nouveau mergeActivities
// + filtre les events sans activite. Aucun nouveau fetch WhatsApp.
import 'dotenv/config';
import { allEvents, upsertMany } from '../src/store.js';

const events = await allEvents();
console.log(`[dedup] ${events.length} events charges`);

// Force re-merge en upsertant chaque event sur lui-meme : mergeActivities()
// va passer ses activites a travers la dedup amelioree (24h normTime + subset).
let cleaned = 0, dropped = 0, totalBefore = 0, totalAfter = 0;

for (const ev of events) {
  totalBefore += (ev.activities || []).length;
  if (!ev.activities?.length) {
    console.log(`  ⊘ drop empty: [${ev.day}] ${(ev.title || ev.venue || '').slice(0, 40)}`);
    dropped++;
    continue;
  }
  await upsertMany([ev], { source: ev.source || 'text' });
  // Re-read pour voir le diff (juste pour le log)
}

// 2eme passe : on lit pour mesurer le resultat
const after = await allEvents();
for (const ev of after) totalAfter += (ev.activities || []).length;

console.log(`[dedup] activities: ${totalBefore} -> ${totalAfter} (dropped ${dropped} empty events)`);

// Suppression manuelle des events vides : on reconstruit le map sans eux.
// Pour ca on doit acceder au store interne — fait via raw redis.
const { Redis } = await import('@upstash/redis');
const r = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const map = (await r.get('playa:events')) || {};
let removed = 0;
for (const [id, ev] of Object.entries(map)) {
  if (!ev.activities?.length) {
    delete map[id];
    removed++;
  }
}
if (removed) {
  await r.set('playa:events', map);
  console.log(`[dedup] removed ${removed} empty events from store`);
}

process.exit(0);
