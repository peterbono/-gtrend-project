import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupKnown, mapUrlFromName, stripFiller, geocodeVenue, coordsFromText } from '../src/geocode.js';

// ── lookupKnown : matching flou des venues KNOWN ─────────────────────────────
// Le bug prod : 3 venues KNOWN restaient lat=null car l'egalite stricte du
// 1er segment ne matchait pas les noms bruts stockes.

test('lookupKnown: "the WAREHOUSE Av. 5 y C. 10" matche la cle "warehouse"', () => {
  const hit = lookupKnown('the WAREHOUSE Av. 5 y C. 10');
  assert.ok(hit);
  assert.equal(hit.lat, 20.6296);
  assert.equal(hit.lon, -87.0758);
});

test('lookupKnown: "STEP DANCE STUDIO PLAYA DEL CARMEN" matche "step dance"', () => {
  const hit = lookupKnown('STEP DANCE STUDIO PLAYA DEL CARMEN');
  assert.ok(hit);
  assert.equal(hit.lat, 20.6240);
});

test('lookupKnown: "Nos vemos en Mexcalli" matche "mexcalli" (filler retire)', () => {
  const hit = lookupKnown('Nos vemos en Mexcalli');
  assert.ok(hit);
  assert.equal(hit.lat, 20.6286);
});

test('lookupKnown: word-boundary, pas de faux positif sur un mot englobant', () => {
  // "warehouses" ne doit PAS matcher la cle "warehouse".
  assert.equal(lookupKnown('Warehouses Cancun Storage'), null);
  assert.equal(lookupKnown('Stepdance Collective'), null);
  assert.equal(lookupKnown('Un bar quelconque'), null);
});

test('geocodeVenue: le KNOWN court-circuite cache/reseau (source "known")', async () => {
  // KNOWN est verifie AVANT le cache : un miss cache 24h ne masque plus le fix.
  const geo = await geocodeVenue('Nos vemos en Mexcalli');
  assert.ok(geo);
  assert.equal(geo.source, 'known');
  assert.equal(geo.found, true);
});

// ── mapUrlFromName : URL Google Maps utilise comme nom de venue ──────────────

test('mapUrlFromName: shortlink sans protocole -> https:// prefixe', () => {
  assert.equal(
    mapUrlFromName('maps.app.goo.gl/2kazpa7CvQ9hQAkt8'),
    'https://maps.app.goo.gl/2kazpa7CvQ9hQAkt8'
  );
});

test('mapUrlFromName: URL avec protocole conserve tel quel', () => {
  assert.equal(
    mapUrlFromName('https://maps.app.goo.gl/abc123'),
    'https://maps.app.goo.gl/abc123'
  );
  assert.equal(
    mapUrlFromName('https://www.google.com/maps/place/Foo'),
    'https://www.google.com/maps/place/Foo'
  );
});

test('mapUrlFromName: un nom de venue normal ne matche pas', () => {
  assert.equal(mapUrlFromName('RAÍCES MIXOLOGY BAR, Calle Corazon'), null);
  assert.equal(mapUrlFromName('On stage academia'), null);
  assert.equal(mapUrlFromName(''), null);
});

// ── stripFiller : prefixes de bruit WhatsApp ─────────────────────────────────

test('stripFiller: retire les prefixes filler courants', () => {
  assert.equal(stripFiller('Nos vemos en Mexcalli'), 'Mexcalli');
  assert.equal(stripFiller('¿Dónde? Zenzi Beach'), 'Zenzi Beach');
  assert.equal(stripFiller('Donde? Zenzi Beach'), 'Zenzi Beach');
  assert.equal(stripFiller('Lugar: HOM Hostel'), 'HOM Hostel');
});

test('stripFiller: ne mutile pas un nom legitime', () => {
  // "Donde" sans "?" peut etre un nom de resto -> on ne touche pas.
  assert.equal(stripFiller('Donde Tito'), 'Donde Tito');
  assert.equal(stripFiller('The Warehouse'), 'The Warehouse');
});

// ── coordsFromText : extraction des coords d'un URL/body Google Maps ─────────

test('coordsFromText: format @lat,lon et !3d!4d', () => {
  assert.deepEqual(
    coordsFromText('https://www.google.com/maps/place/Foo/@20.6308,-87.0721,17z/'),
    { lat: 20.6308, lon: -87.0721 }
  );
  assert.deepEqual(
    coordsFromText('...!3d20.6308!4d-87.0721...'),
    { lat: 20.6308, lon: -87.0721 }
  );
});

test('coordsFromText: format embed !2d(lon)!3d(lat) percent-encode (cas prod goo.gl)', () => {
  // Snippet reel du body resolu de maps.app.goo.gl/2kazpa7CvQ9hQAkt8 :
  // l'ordre est LON puis LAT, et les "!" sont encodes en %21.
  const body = 'laya+del+Carmen%2C+Q.R.%213m12%211m3%211d14935.9%212d-87.0711296%213d20.62986485%212m3';
  assert.deepEqual(coordsFromText(body), { lat: 20.62986485, lon: -87.0711296 });
});

test('coordsFromText: rien a extraire -> null', () => {
  assert.equal(coordsFromText('https://www.google.com/maps?q=Las+miches+day'), null);
  assert.equal(coordsFromText(''), null);
});
