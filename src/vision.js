// Extraction d'evenements depuis une IMAGE de flyer via Google Gemini vision.
// OPTIONNEL : ne s'active que si GEMINI_API_KEY est defini.
// Tier gratuit Gemini : 15 RPM, 1500 RPD (largement suffisant pour ~20 flyers/jour).
// Sert de secours pour les messages qui ne contiennent qu'une image (sans texte).

import { DAY_INDEX } from './days.js';
import { llmVisionJSON } from './llm.js';

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

// La vision marche tant qu'AU MOINS un provider est configure : Gemini (primaire)
// OU OpenRouter (fallback gratuit). Ainsi, credit Google epuise = on bascule.
export function visionEnabled() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}

// La reponse JSON peut etre un tableau direct ou un objet enveloppe
// ({events:[...]}, {eventos:[...]}, {value:[...]}) selon le provider/mode JSON.
export function coerceEventArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['events', 'eventos', 'evenements', 'value', 'data', 'items']) {
      if (Array.isArray(data[k])) return data[k];
    }
    // Objet event unique -> tableau a un element.
    if (data.day || data.activities) return [data];
  }
  return [];
}

export async function extractFromImage(base64, mediaType = 'image/jpeg') {
  if (!visionEnabled()) return [];
  // Gemini d'abord, fallback OpenRouter vision (gratuit) si quota Google epuise.
  const result = await llmVisionJSON(PROMPT, { data: base64, mediaType }, { maxTokens: 1500 });
  if (!result) {
    console.warn('[vision] aucun provider n\'a repondu (quota/parse).');
    return [];
  }
  const raw = coerceEventArray(result.data);
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

// 2e passe : relit l'extraction et consolide doublons / sur-decoupage.
// Passe par llmJSON (Gemini → Groq → OpenRouter) pour rester resilient au quota.
// Skip si rien a consolider (aucun event avec >1 activite). Garde-fous : la
// sortie ne doit jamais perdre un jour ni vider les activites d'un event -> sinon
// on retourne l'extraction brute inchangee.
export async function consolidateEvents(events) {
  if (!visionEnabled() || !events.length) return events;
  if (!events.some((e) => (e.activities || []).length > 1)) return events;

  const payload = events.map((e) => ({ day: e.day, title: e.title, venue: e.venue, activities: e.activities }));
  const { llmJSON } = await import('./llm.js');
  const result = await llmJSON(VERIFY_PROMPT + JSON.stringify(payload), { maxTokens: 1500 });
  if (!result) return events;
  const cleaned = coerceEventArray(result.data);
  if (!cleaned.length) return events;

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
}
