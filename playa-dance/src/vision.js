// Extraction d'evenements depuis une IMAGE de flyer via Claude vision.
// OPTIONNEL : ne s'active que si ANTHROPIC_API_KEY est defini.
// Sert de secours pour les messages qui ne contiennent qu'une image (sans texte).

const PROMPT = `Tu lis un flyer de soirees de danse a Playa del Carmen (Mexique).
Extrais TOUS les jours/evenements visibles. Reponds UNIQUEMENT en JSON, un tableau:
[{"day":"JUEVES","title":"...","venue":"...","activities":[{"time":"7p","name":"Clase de Salsa"}]}]
- day en espagnol MAJUSCULE (DOMINGO, LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO)
- time format court tel qu'ecrit (ex "7p", "9-10p", "9p-1a")
- venue = le lieu (📍). Si absent, null.
Si aucun evenement, reponds [].`;

import { DAY_INDEX } from './days.js';

export function visionEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function extractFromImage(base64, mediaType = 'image/jpeg') {
  if (!visionEnabled()) return [];
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    console.warn('[vision] @anthropic-ai/sdk non installe, etape ignoree.');
    return [];
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.VISION_MODEL || 'claude-opus-4-8';

  const resp = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });

  const text = resp.content.find((c) => c.type === 'text')?.text || '[]';
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn('[vision] reponse non parsable:', text.slice(0, 120));
    return [];
  }
  // Normalise vers le meme format que le parser texte.
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
