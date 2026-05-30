// Proxy vers OSRM (public demo, gratuit) pour calculer un itineraire pieton.
// Cote client on appelle /api/route?from=lat,lon&to=lat,lon
// Retourne distance (m), duration (s), geometry GeoJSON.

export default async function handler(req, res) {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to required' });
  const [lat1, lon1] = String(from).split(',').map(Number);
  const [lat2, lon2] = String(to).split(',').map(Number);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return res.status(400).json({ error: 'invalid coords' });
  }
  const url = `https://router.project-osrm.org/route/v1/foot/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'playa-dance/1.0' } });
    if (!r.ok) return res.status(502).json({ error: 'osrm http ' + r.status });
    const data = await r.json();
    const route = data?.routes?.[0];
    if (!route) return res.json({ ok: false });
    res.setHeader('cache-control', 'public, max-age=3600, s-maxage=86400');
    res.json({
      ok: true,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
