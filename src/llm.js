// Wrapper unifie : tente Gemini d'abord, fallback Groq si quota Gemini epuise.
// Les deux APIs supportent une sortie JSON propre.

const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

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

// Demande un JSON, essaie Gemini puis Groq en fallback.
export async function llmJSON(prompt, opts = {}) {
  let result = await callGemini(prompt, opts);
  if (!result.ok) {
    console.warn('[llm] gemini failed:', result.reason, '— trying Groq fallback');
    result = await callGroq(prompt, opts);
  }
  if (!result.ok) {
    console.warn('[llm] both providers failed:', result.reason);
    return null;
  }
  try {
    return { data: JSON.parse(result.text), source: result.source };
  } catch {
    console.warn('[llm] unparseable JSON from', result.source, ':', result.text.slice(0, 120));
    return null;
  }
}
