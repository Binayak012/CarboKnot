// Vercel serverless function: /api/reason
//
// Mirrors carboknot/proxy/index.js#handleReason for Vercel deployment.
// Tries Gemini first, then Dedalus LLM, then returns a local fallback.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEDALUS_API_KEY = process.env.DEDALUS_API_KEY || '';
const DEDALUS_API_ENDPOINT =
  process.env.DEDALUS_API_ENDPOINT || 'https://api.dedaluslabs.ai/v1/chat/completions';
const DEDALUS_MODEL = process.env.DEDALUS_MODEL || 'openai/gpt-5';
const REASON_TIMEOUT_MS = 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(res, origin) {
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('access-control-allow-origin', allow);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, accept');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'origin');
}

function validNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

function buildReasonPrompt(orig, alt) {
  const saving = Math.max(0, orig.kg_total - alt.kg_total);
  const pct = orig.kg_total > 0 ? Math.round((saving / orig.kg_total) * 100) : 0;
  return {
    system:
      'You are an LCA expert explaining why one product has a lower carbon footprint than another. ' +
      'Respond in 2 short sentences, max 60 words total. Cite the main emission stage that is reduced ' +
      '(manufacturing, shipping, packaging, or end-of-life). Do not use emojis. Do not restate the numbers.',
    user:
      `Original: "${orig.title}" — ${orig.kg_total.toFixed(1)} kg CO2e, category ${orig.category || 'unknown'}.\n` +
      `Alternative: "${alt.title}" — ${alt.kg_total.toFixed(1)} kg CO2e (${pct}% less), category ${alt.category || orig.category || 'unknown'}.\n` +
      `Explain why the alternative is lower carbon.`
  };
}

function localRationale(orig, alt) {
  const pct = orig.kg_total > 0
    ? Math.round(((orig.kg_total - alt.kg_total) / orig.kg_total) * 100)
    : 0;
  return `Avoids new-unit manufacturing, the dominant emission stage for this category. Estimated ${pct}% less CO2e based on category-level LCA averages.`;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  applyCors(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const payload = req.body;
  if (!payload || !payload.original || !payload.alternative) {
    return res.status(400).json({ error: 'bad_payload' });
  }
  const { original, alternative } = payload;
  if (!validNumber(original?.kg_total) || !validNumber(alternative?.kg_total)) {
    return res.status(400).json({ error: 'bad_payload' });
  }

  const fallback = { rationale: localRationale(original, alternative), source: 'fallback' };
  const prompt = buildReasonPrompt(original, alternative);

  // 1. Try Gemini
  if (GEMINI_API_KEY) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const data = await fetchWithTimeout(geminiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { maxOutputTokens: 180, temperature: 0.3 }
        })
      }, REASON_TIMEOUT_MS);
      const rationale = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!rationale) throw new Error('empty_gemini_response');
      return res.status(200).json({ rationale, source: 'gemini' });
    } catch (err) {
      console.warn('[api/reason] Gemini fallback:', err?.name || 'error', err?.message || '');
    }
  }

  // 2. Try Dedalus LLM
  if (DEDALUS_API_KEY) {
    try {
      const llm = await fetchWithTimeout(DEDALUS_API_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${DEDALUS_API_KEY}` },
        body: JSON.stringify({
          model: DEDALUS_MODEL,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          max_tokens: 180,
          temperature: 0.3
        })
      }, REASON_TIMEOUT_MS);
      const rationale = llm?.choices?.[0]?.message?.content?.trim();
      if (!rationale) throw new Error('empty_llm_response');
      return res.status(200).json({ rationale, source: 'dedalus_llm' });
    } catch (err) {
      console.warn('[api/reason] Dedalus fallback:', err?.name || 'error');
    }
  }

  return res.status(200).json(fallback);
}
