// LLM providers for the tutor. Each takes { system, turns } and returns text.
// turns: [{ role: 'user' | 'assistant', text, images?: [{ mime, data }] }]  (data = base64, no prefix)
// Keys come from env vars; any subset works. Models are overridable via env so they can be updated without a deploy.

const TIMEOUT_MS = 25000;

async function post(url, headers, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const raw = await res.text();
    let json; try { json = JSON.parse(raw); } catch { json = null; }
    if (!res.ok) {
      const err = new Error(`${res.status} ${(json?.error?.message || json?.error || raw).toString().slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally { clearTimeout(timer); }
}

const openAIMessages = (system, turns) => [
  { role: 'system', content: system },
  ...turns.map((t) => ({
    role: t.role,
    content: t.images?.length
      ? [{ type: 'text', text: t.text }, ...t.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
      : t.text
  }))
];

export const PROVIDERS = [
  {
    id: 'anthropic', vision: true,
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    async call({ system, turns }) {
      const model = this.model();
      const j = await post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': this.key(), 'anthropic-version': '2023-06-01' },
        {
          model, max_tokens: 1100, system,
          messages: turns.map((t) => ({
            role: t.role,
            content: [...(t.images || []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: t.text }]
          }))
        });
      return { text: j.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), model };
    }
  },
  {
    id: 'gemini', vision: true,
    key: () => process.env.GEMINI_API_KEY,
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    async call({ system, turns }) {
      const model = this.model();
      const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': this.key() },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({
            role: t.role === 'assistant' ? 'model' : 'user',
            parts: [...(t.images || []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: t.text }]
          })),
          generationConfig: { maxOutputTokens: 2400, temperature: 0.4 }
        });
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error('empty response' + (j.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''));
      return { text, model };
    }
  },
  {
    id: 'groq', vision: true,
    key: () => process.env.GROQ_API_KEY,
    // text-only requests use the stronger text model; image requests need a vision model
    model: (hasImages) => hasImages ? (process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct') : (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
    async call({ system, turns }) {
      const model = this.model(turns.some((t) => t.images?.length));
      const j = await post('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${this.key()}` },
        { model, messages: openAIMessages(system, turns), max_tokens: 1100, temperature: 0.4 });
      return { text: j.choices[0].message.content, model };
    }
  },
  {
    id: 'xai', vision: true,   // xAI Grok (OpenAI-compatible)
    key: () => process.env.XAI_API_KEY,
    model: () => process.env.XAI_MODEL || 'grok-4-fast',
    async call({ system, turns }) {
      const model = this.model();
      const j = await post('https://api.x.ai/v1/chat/completions', { Authorization: `Bearer ${this.key()}` },
        { model, messages: openAIMessages(system, turns), max_tokens: 1100, temperature: 0.4 });
      const text = j.choices?.[0]?.message?.content;
      if (!text) throw new Error('empty response');
      return { text, model };
    }
  },
  {
    id: 'openrouter', vision: true,
    key: () => process.env.OPENROUTER_API_KEY,
    model: () => process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free',
    async call({ system, turns }) {
      const model = this.model();
      const j = await post('https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${this.key()}`, 'X-Title': 'SAT Nexus' },
        { model, messages: openAIMessages(system, turns), max_tokens: 1100, temperature: 0.4 });
      const text = j.choices?.[0]?.message?.content;
      if (!text) throw new Error('empty response');
      return { text, model };
    }
  }
];

// Providers that returned 429 sit out for a minute (per warm instance), so the next request skips straight to a working one.
const cooldown = new Map();

export function configured() {
  const order = (process.env.AI_PROVIDERS || 'anthropic,xai,gemini,groq,openrouter').split(',').map((s) => s.trim());
  return order.map((id) => PROVIDERS.find((p) => p.id === id)).filter((p) => p && p.key());
}

export async function generate(req) {
  const chain = configured();
  if (!chain.length) { const e = new Error('No AI provider is configured'); e.code = 'not_configured'; throw e; }
  const tried = [];
  const now = Date.now();
  const live = chain.filter((p) => (cooldown.get(p.id) || 0) < now);
  for (const p of live.length ? live : chain) {
    try {
      const r = await p.call(req);
      return { ...r, provider: p.id, tried };
    } catch (e) {
      tried.push(`${p.id}: ${e.message}`.slice(0, 220));
      if (e.status === 429 || e.status === 503) cooldown.set(p.id, Date.now() + 60000);
    }
  }
  const e = new Error('All AI providers failed'); e.tried = tried; throw e;
}
