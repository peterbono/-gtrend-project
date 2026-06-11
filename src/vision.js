// Extraction d'evenements depuis une IMAGE de flyer via Google Gemini vision.
// OPTIONNEL : ne s'active que si GEMINI_API_KEY est defini.
// Tier gratuit Gemini : 15 RPM, 1500 RPD (largement suffisant pour ~20 flyers/jour).
// Sert de secours pour les messages qui ne contiennent qu'une image (sans texte).

import { DAY_INDEX } from './days.js';

const PROMPT = `Tu lis un flyer de soirees de danse a Playa del Carmen (Mexique).
Extrais TOUS les jours/evenements visibles. Reponds UNIQUEMENT en JSON, un tableau:
[{"day":"JUEVES","title":"...","venue":"...","activities":[{"time":"7p","name":"Clase de Salsa"}]}]
- day en espagnol MAJUSCULE (DOMINGO, LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO)
- time format court tel qu'ecrit (ex "7p", "9-10p", "9p-1a")
- venue = le lieu (📍). Si absent, null.
- UNE activite = UN cours ou UNE soiree. Mets le niveau DANS le nom du cours
  (ex "Clase de Salsa Cubana - Intermedio Avanzado"), ne le sors JAMAIS en ligne
  separee. N'ecris pas deux fois la meme chose en espagnol puis en anglais.
- Ne duplique pas une activite : un seul item par creneau reel.
Si aucun evenement, reponds [].`;

// Passe de relecture : l'extraction peut sur-decouper (un cours + son niveau en
// deux lignes a la meme heure) ou doubler ES/EN. On RELIT le JSON et on consolide
// avant publication. Defensif partout : tout echec -> on garde l'extraction brute.
const VERIFY_PROMPT = `Tu recois un planning de soirees de danse extrait d'un flyer (JSON).
Il peut contenir des DOUBLONS ou du SUR-DECOUPAGE : ex un cours et son niveau sortis
en deux lignes au meme horaire, ou la meme chose en espagnol puis en anglais.
Consolide SANS rien inventer ni perdre d'info reelle :
- Fusionne en UNE activite les lignes qui decrivent le meme cours/soiree au meme
  horaire ; garde le nom le plus complet.
- Une ligne qui n'est qu'un niveau ou une annotation d'une autre activite au meme
  horaire doit etre absorbee dans celle-ci.
- Ne fusionne PAS deux activites reellement differentes (style ou horaire differents).
- Ne change ni les jours, ni les lieux, ni les horaires.
Reponds UNIQUEMENT avec le MEME format JSON (tableau d'events {day,title,venue,activities:[{time,name}]}).
JSON a consolider :
`;

export function visionEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function extractFromImage(base64, mediaType = 'image/jpeg') {
  if (!visionEnabled()) return [];
  const model = process.env.VISION_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mediaType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0,
      max_output_tokens: 1500,
    },
  };

  let text = '[]';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(`[vision] Gemini ${resp.status}:`, (await resp.text()).slice(0, 200));
      return [];
    }
    const data = await resp.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  } catch (err) {
    console.warn('[vision] requete Gemini echouee:', err.message);
    return [];
  }

  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn('[vision] reponse non parsable:', text.slice(0, 120));
    return [];
  }
  const events = raw
    .filter((e) => e && DAY_INDEX[e.day?.toUpperCase?.()] !== undefined)
    .map((e) => ({
      day: e.day.toUpperCase(),
      dayIndex: DAY_INDEX[e.day.toUpperCase()],
      title: e.title || '',
      venue: e.venue || null,
      mapUrl: e.mapUrl || null,
      activities: Array.isArray(e.activities) ? e.activities : [],
    }));

  return consolidateEvents(events);
}

// 2e passe Gemini : relit l'extraction et consolide doublons / sur-decoupage.
// Skip si rien a consolider (aucun event avec >1 activite). Garde-fous : la
// sortie ne doit jamais perdre un jour ni vider les activites d'un event -> sinon
// on retourne l'extraction brute inchangee.
export async function consolidateEvents(events) {
  if (!visionEnabled() || !events.length) return events;
  if (!events.some((e) => (e.activities || []).length > 1)) return events;

  const model = process.env.VISION_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const payload = events.map((e) => ({ day: e.day, title: e.title, venue: e.venue, activities: e.activities }));
  const body = {
    contents: [{ parts: [{ text: VERIFY_PROMPT + JSON.stringify(payload) }] }],
    generationConfig: { response_mime_type: 'application/json', temperature: 0, max_output_tokens: 1500 },
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return events;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const cleaned = JSON.parse(json);
    if (!Array.isArray(cleaned)) return events;

    const mapped = cleaned
      .filter((e) => e && DAY_INDEX[e.day?.toUpperCase?.()] !== undefined)
      .map((e) => ({
        day: e.day.toUpperCase(),
        dayIndex: DAY_INDEX[e.day.toUpperCase()],
        title: e.title || '',
        venue: e.venue ?? null,
        mapUrl: e.mapUrl ?? null,
        activities: Array.isArray(e.activities) ? e.activities : [],
      }));

    // Garde-fous : pas moins d'events, et aucun event reel vide apres coup.
    if (mapped.length < events.length) return events;
    if (mapped.some((e) => e.activities.length === 0)) return events;
    return mapped;
  } catch (err) {
    console.warn('[vision] consolidation echouee, fallback extraction brute:', err.message);
    return events;
  }
}
