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

// Prefixes "filler" frequents dans les annonces WhatsApp ("Nos vemos en X",
// "¿Donde? X", "Lugar: X") : du bruit a retirer avant tout lookup ou geocodage.
// NB : "donde" seul exige le "?" pour ne pas amputer un nom de resto type "Donde Tito".
const FILLER_PREFIXES = [
  /^\s*(?:¿\s*d[oó]nde\s*\??|d[oó]nde\s*\?)\s*:?\s*/i,
  /^\s*nos\s+vemos\s+en\s+/i,
  /^\s*(?:lugar|ubicaci[oó]n|direcci[oó]n|venue|spot|where)\s*:\s*/i,
];
export function stripFiller(name) {
  let s = String(name || '').trim();
  let prev;
  do {
    prev = s;
    for (const re of FILLER_PREFIXES) s = s.replace(re, '');
    s = s.trim();
  } while (s && s !== prev);
  return s || String(name || '').trim();
}

// Variations de query a tenter, du plus precis au plus large.
function queryVariants(name) {
  const out = [];
  const base = stripFiller(name.trim());
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
// Extraction pure des coords depuis un URL ou un body Google Maps.
// Les pages embarquent souvent les params en percent-encoding (%21 = "!"),
// on decode avant de matcher.
export function coordsFromText(src) {
  if (!src) return null;
  const s = String(src).replace(/%21/gi, '!').replace(/%2C/gi, ',');
  // .../@20.6308,-87.0721,17z/...
  const m1 = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m1) return { lat: parseFloat(m1[1]), lon: parseFloat(m1[2]) };
  // !3d20.6308!4d-87.0721 (format "place" : lat puis lon)
  const m2 = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m2) return { lat: parseFloat(m2[1]), lon: parseFloat(m2[2]) };
  // !2d-87.0721!3d20.6308 (format "embed/dir" : LON puis LAT, ordre inverse)
  const m3 = s.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  if (m3) return { lat: parseFloat(m3[2]), lon: parseFloat(m3[1]) };
  return null;
}

async function coordsFromMapUrl(url) {
  if (!url || !/maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps/.test(url)) return null;
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const text = await r.text();
    for (const src of [r.url, text]) {
      const coords = coordsFromText(src);
      if (coords) return coords;
    }
  } catch { /* ignore */ }
  return null;
}

// Certains messages stockent le lien Google Maps comme NOM de venue
// ("maps.app.goo.gl/xyz", avec ou sans protocole). On le detecte pour
// l'unfurler au lieu d'envoyer un URL en query Nominatim (toujours un miss).
export function mapUrlFromName(name) {
  const m = String(name || '').match(/(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps)\/\S+/i);
  if (!m) return null;
  return /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
}

// Overrides manuels : venues recherchees a la main (adresses confirmees) pour les
// lieux frequents de la scene danse de Playa del Carmen, evite tout appel LLM.
const KNOWN = {
  // The Warehouse PDC : Av 20 entre Calle 4 et 6 Norte, Centro
  'warehouse': { lat: 20.6296, lon: -87.0758 },
  // MEXCALLI : Quinta Avenida entre Calle 4 et 6 (5ta Av zone)
  'mexcalli': { lat: 20.6286, lon: -87.0719 },
  // STEP DANCE : Av 45 Sur y Calle 1 Bis Sur (zone sud)
  'step dance': { lat: 20.6240, lon: -87.0834 },
};
// Matching flou : les venues stockees arrivent avec du bruit ("the WAREHOUSE
// Av. 5 y C. 10", "STEP DANCE STUDIO PLAYA DEL CARMEN", "Nos vemos en Mexcalli").
// L'egalite stricte du 1er segment ratait tout ca. On normalise (minuscules,
// accents, filler, articles, ponctuation) puis on cherche la cle KNOWN comme
// mot entier (word-boundary) n'importe ou dans le nom, pour eviter les faux
// positifs type "warehouses".
function normalizeForKnown(name) {
  return stripFiller(String(name || ''))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(the|la|el|le|los|las)\s+/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function lookupKnown(name) {
  const norm = normalizeForKnown(name);
  if (!norm) return null;
  for (const [k, coords] of Object.entries(KNOWN)) {
    const re = new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
    if (re.test(norm)) return coords;
  }
  return null;
}

// Fallback Gemini : on demande au LLM les coords GPS du lieu, avec sanity check
// qu'il tombe dans la zone Playa del Carmen. Gemini 2.5 connait les venues populaires
// de Playa beaucoup mieux que Nominatim/OSM (qui rate les petits clubs).
async function geocodeViaLLM(venueName) {
  const { llmJSON } = await import('./llm.js');
  const prompt = `Tu es un expert local de Playa del Carmen (Quintana Roo, Mexique). Donne-moi les coordonnees GPS precises du lieu nomme "${venueName}" (club de danse, bar, restaurant, rooftop ou salle de cours). Reponds UNIQUEMENT en JSON: {"lat":NUMBER,"lon":NUMBER,"address":"..."}. Si tu ne connais pas: {"lat":null,"lon":null}.`;
  const result = await llmJSON(prompt, { maxTokens: 300 });
  if (!result?.data) return null;
  const parsed = result.data;
  if (parsed.lat == null || parsed.lon == null) return null;
  if (parsed.lat < 20.55 || parsed.lat > 20.72 || parsed.lon < -87.15 || parsed.lon > -86.98) return null;
  return {
    lat: parsed.lat,
    lon: parsed.lon,
    address: parsed.address || null,
    source: result.source,
    found: true,
  };
}

// Batch : demande d'un coup les coords de plusieurs venues via LLM (Gemini puis Groq).
// Beaucoup plus economique en quota qu'1 appel par venue.
export async function geocodeManyViaLLM(names) {
  if (!names.length) return new Map();
  const { llmJSON } = await import('./llm.js');
  const prompt = `Tu es un expert local de Playa del Carmen (Quintana Roo, Mexique). Donne-moi les coordonnees GPS precises de ces lieux (clubs de danse, bars, restaurants, rooftops, salles de cours) :
${names.map((n, i) => `${i + 1}. "${n}"`).join('\n')}

Reponds UNIQUEMENT en JSON. Format :
{"venues":[{"name":"...","lat":NUMBER,"lon":NUMBER,"address":"..."},...]}
Le tableau doit avoir EXACTEMENT ${names.length} entrees, dans le MEME ordre. Pour un lieu vraiment inconnu : "lat":null,"lon":null.`;
  const result = await llmJSON(prompt, { maxTokens: 2000 });
  if (!result?.data) return new Map();
  const arr = Array.isArray(result.data) ? result.data : result.data.venues || [];
  const out = new Map();
  for (let i = 0; i < arr.length && i < names.length; i++) {
    const item = arr[i];
    if (item?.lat == null || item?.lon == null) continue;
    if (item.lat < 20.55 || item.lat > 20.72 || item.lon < -87.15 || item.lon > -86.98) continue;
    out.set(names[i], { lat: item.lat, lon: item.lon, address: item.address || null, source: result.source, found: true });
  }
  return out;
}

// Compat : ancien nom
export const geocodeManyViaGemini = geocodeManyViaLLM;

export async function geocodeVenue(name, mapUrl = null) {
  if (!name || typeof name !== 'string') return null;

  // 1) Override venues connues : AVANT le cache, sinon un miss ({found:false})
  //    cache 24h masque toute amelioration du matching KNOWN. Lookup instantane,
  //    pas besoin de le cacher.
  const known = lookupKnown(name);
  if (known) {
    return { ...known, source: 'known', found: true };
  }

  const key = cacheKey(name);
  const cached = await getCache(key);

  // 2) Le "nom" est lui-meme un lien Google Maps : on l'unfurl directement.
  //    On ignore un eventuel miss cache (l'unfurl peut reussir la ou Nominatim
  //    avait echoue avec l'URL en query), mais on reutilise un hit cache.
  const urlInName = mapUrlFromName(name);
  if (urlInName) {
    if (cached?.found) return cached;
    const fromUrl = await coordsFromMapUrl(urlInName);
    if (fromUrl) {
      const coords = { ...fromUrl, source: 'mapurl', found: true };
      await setCache(key, coords, CACHE_TTL_HIT);
      return coords;
    }
    await setCache(key, { found: false }, CACHE_TTL_MISS);
    return null;
  }

  if (cached) return cached.found ? cached : null;

  // 3) Si on a un shortlink Google Maps, on l'unfurl.
  if (mapUrl) {
    const fromUrl = await coordsFromMapUrl(mapUrl);
    if (fromUrl) {
      const coords = { ...fromUrl, source: 'mapurl', found: true };
      await setCache(key, coords, CACHE_TTL_HIT);
      return coords;
    }
  }

  // 4) Nominatim avec variants (filler deja retire par queryVariants).
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

  // 5) Dernier recours : LLM (Gemini, fallback Groq).
  const llm = await geocodeViaLLM(stripFiller(name));
  if (llm) {
    await setCache(key, llm, CACHE_TTL_HIT);
    return llm;
  }

  await setCache(key, { found: false }, CACHE_TTL_MISS);
  return null;
}
