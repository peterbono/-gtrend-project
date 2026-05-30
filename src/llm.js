// Wrapper unifie : tente Gemini d'abord, fallback Groq, puis OpenRouter.
// Tous supportent une sortie JSON propre + extension pour les vision (image input).

const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callGemini(prompt, { maxTokens = 800 } = {}) {
  if (!process.env.GEMINI_API_KEY) return { ok: false, reason: 'no-key' };
  const model = process.env.VISION_MODEL || 'gemini-2.5-flash';
  const url = `${GEMINI_URL_BASE}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0, max_output_tokens: maxTokens },
      }),
    });
    if (r.status === 429) return { ok: false, reason: 'quota' };
    if (!r.ok) return { ok: false, reason: 'http-' + r.status };
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { ok: true, text, source: 'gemini' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function callGroq(prompt, { maxTokens = 800 } = {}) {
  if (!process.env.GROQ_API_KEY) return { ok: false, reason: 'no-key' };
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
    if (!r.ok) return { ok: false, reason: 'http-' + r.status };
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, text, source: 'groq' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function callOpenRouter(prompt, { maxTokens = 800, image = null } = {}) {
  if (!process.env.OPENROUTER_API_KEY) return { ok: false, reason: 'no-key' };
  // Modeles vision/texte gratuits OpenRouter (ordonnes par preference)
  // Modeles verifies dispos sur OpenRouter free tier (rotation possible via env).
  const model = image
    ? (process.env.OPENROUTER_VISION_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free')
    : (process.env.OPENROUTER_TEXT_MODEL || 'openai/gpt-oss-20b:free');
  const content = image
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }]
    : prompt;
  try {
    const r = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'http-referer': 'https://playa-dance.vercel.app',
        'x-title': 'Playa Dance',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
    if (!r.ok) return { ok: false, reason: 'http-' + r.status };
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, text, source: 'openrouter:' + model };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Demande un JSON, chaine de fallback : Gemini → Groq → OpenRouter.
export async function llmJSON(prompt, opts = {}) {
  let result = await callGemini(prompt, opts);
  if (!result.ok) {
    console.warn('[llm] gemini:', result.reason, '— Groq fallback');
    result = await callGroq(prompt, opts);
  }
  if (!result.ok) {
    console.warn('[llm] groq:', result.reason, '— OpenRouter fallback');
    result = await callOpenRouter(prompt, opts);
  }
  if (!result.ok) {
    console.warn('[llm] all providers failed:', result.reason);
    return null;
  }
  try {
    return { data: JSON.parse(result.text), source: result.source };
  } catch {
    console.warn('[llm] unparseable JSON from', result.source, ':', result.text.slice(0, 120));
    return null;
  }
}

// Vision : Gemini → OpenRouter (Groq n'a pas de vision gratuite fiable).
export async function llmVisionJSON(prompt, image, opts = {}) {
  // Pour la vision on appelle Gemini avec l'image directement (vision.js le fait deja).
  // Si quota Gemini down, on bascule sur OpenRouter qui a des modeles vision gratuits.
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.VISION_MODEL || 'gemini-2.5-flash';
    const url = `${GEMINI_URL_BASE}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.mediaType, data: image.data } }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0, max_output_tokens: opts.maxTokens || 1500 },
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        try { return { data: JSON.parse(text), source: 'gemini-vision' }; } catch { /* fall through */ }
      } else {
        console.warn('[llm-vision] gemini:', r.status);
      }
    } catch (e) { console.warn('[llm-vision] gemini error:', e.message); }
  }
  // Fallback OpenRouter
  const result = await callOpenRouter(prompt, { ...opts, image });
  if (!result.ok) return null;
  try { return { data: JSON.parse(result.text), source: result.source }; } catch { return null; }
}
