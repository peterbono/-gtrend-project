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
Si aucun evenement, reponds [].`;

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
  return raw
    .filter((e) => e && DAY_INDEX[e.day?.toUpperCase?.()] !== undefined)
    .map((e) => ({
      day: e.day.toUpperCase(),
      dayIndex: DAY_INDEX[e.day.toUpperCase()],
      title: e.title || '',
      venue: e.venue || null,
      mapUrl: e.mapUrl || null,
      activities: Array.isArray(e.activities) ? e.activities : [],
    }));
}
