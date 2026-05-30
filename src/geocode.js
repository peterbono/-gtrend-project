// Geocodage Nominatim (OSM) avec cache Upstash. Lookup borne a Playa del Carmen.
// Free tier rate limit : 1 req/sec — on cache 90 jours les hits, 1 jour les miss.

const CACHE_TTL_HIT = 90 * 24 * 3600;
const CACHE_TTL_MISS = 24 * 3600;
const UA = 'playa-dance/1.0 (https://playa-dance.vercel.app)';
const PLAYA_VIEWBOX = '-87.10,20.59,-87.04,20.69';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let _redis;
async function redis() {
  if (_redis) return _redis;
  const { Redis } = await import('@upstash/redis');
  _redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  return _redis;
}

function cacheKey(name) {
  return `geo:${name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
}

async function getCache(key) {
  if (!REDIS_URL) return null;
  try { return await (await redis()).get(key); } catch { return null; }
}
async function setCache(key, value, ttl) {
  if (!REDIS_URL) return;
  try { await (await redis()).set(key, value, { ex: ttl }); } catch { /* ignore */ }
}

// Variations de query a tenter, du plus precis au plus large.
function queryVariants(name) {
  const out = [];
  const base = name.trim();
  out.push(`${base}, Playa del Carmen, Quintana Roo, Mexico`);
  // Sans le ", AVENIDA ..." suffix qui peut perturber
  const noStreet = base.replace(/,\s*avenida.*$/i, '').trim();
  if (noStreet !== base) out.push(`${noStreet}, Playa del Carmen, Quintana Roo, Mexico`);
  // Sans article "the/la/el"
  const noArticle = base.replace(/^(the|la|el|le)\s+/i, '').trim();
  if (noArticle !== base) out.push(`${noArticle}, Playa del Carmen, Quintana Roo, Mexico`);
  // Premier mot uniquement (ex "MEXCALLI") + ville
  const firstToken = base.split(/[\s,;]+/)[0];
  if (firstToken && firstToken.length > 3 && firstToken.toLowerCase() !== noArticle.toLowerCase()) {
    out.push(`${firstToken}, Playa del Carmen, Quintana Roo, Mexico`);
  }
  return out;
}

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=mx&viewbox=${PLAYA_VIEWBOX}&bounded=1`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en' } });
  if (!r.ok) return null;
  const data = await r.json();
  return data[0] || null;
}

// Beaucoup de venues de Playa ne sont pas dans OSM. Si on a un shortlink Google Maps
// (maps.app.goo.gl), on le suit pour extraire les coords du long URL.
async function coordsFromMapUrl(url) {
  if (!url || !/maps\.app\.goo\.gl|google\.com\/maps/.test(url)) return null;
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const text = await r.text();
    const candidates = [r.url, text];
    for (const src of candidates) {
      // .../@20.6308,-87.0721,17z/...
      const m1 = src.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m1) return { lat: parseFloat(m1[1]), lon: parseFloat(m1[2]) };
      // !3d20.6308!4d-87.0721
      const m2 = src.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (m2) return { lat: parseFloat(m2[1]), lon: parseFloat(m2[2]) };
    }
  } catch { /* ignore */ }
  return null;
}

// Quelques venues connues de Playa, override prioritaire (coords approximatives).
const KNOWN = {
  'warehouse': { lat: 20.6308, lon: -87.0721 },         // Av. 20 entre Calles 4 y 6
  'mexcalli': { lat: 20.6243, lon: -87.0698 },          // 5ta avenida zone
  'step dance': { lat: 20.6276, lon: -87.0712 },
  'lush latin dance party': { lat: 20.6308, lon: -87.0721 },
  'hyatt centric playa del carmen': { lat: 20.6274, lon: -87.0688 },
};
function lookupKnown(name) {
  const k = name.toLowerCase().split(',')[0].replace(/^\s*(the|la|el|le)\s+/, '').trim();
  return KNOWN[k] || null;
}

export async function geocodeVenue(name, mapUrl = null) {
  if (!name || typeof name !== 'string') return null;
  const key = cacheKey(name);
  const cached = await getCache(key);
  if (cached) return cached.found ? cached : null;

  // 1) Override venues connues (instantane).
  const known = lookupKnown(name);
  if (known) {
    const coords = { ...known, source: 'known', found: true };
    await setCache(key, coords, CACHE_TTL_HIT);
    return coords;
  }

  // 2) Si on a un shortlink Google Maps, on l'unfurl.
  if (mapUrl) {
    const fromUrl = await coordsFromMapUrl(mapUrl);
    if (fromUrl) {
      const coords = { ...fromUrl, source: 'mapurl', found: true };
      await setCache(key, coords, CACHE_TTL_HIT);
      return coords;
    }
  }

  // 3) Nominatim avec variants.
  for (const q of queryVariants(name)) {
    const hit = await nominatim(q);
    if (hit) {
      const coords = {
        lat: parseFloat(hit.lat),
        lon: parseFloat(hit.lon),
        displayName: hit.display_name,
        source: 'nominatim',
        found: true,
      };
      await setCache(key, coords, CACHE_TTL_HIT);
      return coords;
    }
    await new Promise((r) => setTimeout(r, 1100));
  }

  await setCache(key, { found: false }, CACHE_TTL_MISS);
  return null;
}
