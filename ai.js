// ai.js — main-process Ollama client
// Uses the native /api/chat endpoint (NDJSON streaming).
// Never exposes the URL, port, or model name to the renderer.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

// Abort controllers keyed by request id, so the renderer can cancel.
const activeRequests = new Map();

function newRequestId() {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Health check — is Ollama reachable?
// ---------------------------------------------------------------------------
async function aiHealth(model) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const wanted = (typeof model === 'string' && model.trim()) ? model.trim() : DEFAULT_MODEL;
    return { ok: true, models, hasDefault: models.includes(wanted), checkedModel: wanted };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'unreachable') };
  }
}

// ---------------------------------------------------------------------------
// Chat — non-streaming. Returns the full reply as a string.
// ---------------------------------------------------------------------------
async function aiChat({ messages, model, options }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 400,
        ...(options || {}),
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.message?.content || '';
}

// ---------------------------------------------------------------------------
// Chat — streaming. Emits chunks via the provided `onChunk` callback.
// Returns the full assembled text when done.
// ---------------------------------------------------------------------------
async function aiChatStream({ messages, model, options, onChunk, requestId }) {
  const id = requestId || newRequestId();
  const controller = new AbortController();
  activeRequests.set(id, controller);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        stream: true,
        options: {
          temperature: 0.3,
          num_predict: 500,
          ...(options || {}),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // NDJSON: one JSON object per line
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const piece = obj.message?.content || '';
          if (piece) {
            full += piece;
            if (typeof onChunk === 'function') onChunk(piece);
          }
          if (obj.done) {
            activeRequests.delete(id);
            return { text: full, requestId: id, done: true };
          }
        } catch (parseErr) {
          // Partial line — skip.
        }
      }
    }

    activeRequests.delete(id);
    return { text: full, requestId: id, done: true };
  } catch (err) {
    activeRequests.delete(id);
    if (err.name === 'AbortError') {
      return { text: '', requestId: id, aborted: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Chat — non-streaming, with tool-calling support (function calling).
// Returns the raw assistant message ({ content, tool_calls? }).
// ---------------------------------------------------------------------------
async function aiChatTools({ messages, model, tools, options, requestId }) {
  const id = requestId || newRequestId();
  const controller = new AbortController();
  activeRequests.set(id, controller);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        tools: tools || [],
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 600,
          ...(options || {}),
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return { message: data.message || { content: '' }, requestId: id };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { message: { content: '', tool_calls: [] }, requestId: id, aborted: true };
    }
    throw err;
  } finally {
    activeRequests.delete(id);
  }
}

function aiAbort(requestId) {
  const ctrl = activeRequests.get(requestId);
  if (ctrl) {
    ctrl.abort();
    activeRequests.delete(requestId);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Task parsing — the ✨ feature.
// Single-shot, low temperature, strict JSON output.
// ---------------------------------------------------------------------------
const PARSE_SYSTEM_PROMPT = `You extract structured task data from a user's sentence.
Output ONLY a single JSON object. No prose. No markdown. No code fences.
Schema:
{
  "text":     string,             // the task title, concise, imperative
  "desc":     string | null,      // extra detail, or null
  "due":      "YYYY-MM-DD" | null,// absolute date, or null
  "priority": "low" | "medium" | "high",
  "category": string | null       // single word or short phrase, or null
}
Today's date is {{TODAY}}. Resolve relative dates (tomorrow, friday, next week) against that.
If a field is not stated, use null (or "medium" for priority).
Never invent a due date.`;

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { /* keep looking */ }
      }
    }
  }
  return null;
}

async function aiParseTask({ sentence }) {
  const sys = PARSE_SYSTEM_PROMPT.replace('{{TODAY}}', todayISO());
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: sentence },
  ];

  let raw = await aiChat({
    messages,
    options: { temperature: 0.1, num_predict: 200 },
  });
  let parsed = extractJSON(raw);

  if (!parsed) {
    raw = await aiChat({
      messages: [
        ...messages,
        { role: 'user', content: 'Return ONLY the JSON object. No other text.' },
      ],
      options: { temperature: 0.0, num_predict: 200 },
    });
    parsed = extractJSON(raw);
  }

  if (!parsed) {
    return { ok: false, raw, error: 'Model did not return valid JSON.' };
  }

  const out = {
    text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
    desc: typeof parsed.desc === 'string' && parsed.desc.trim() ? parsed.desc.trim() : null,
    due: /^\d{4}-\d{2}-\d{2}$/.test(parsed.due || '') ? parsed.due : null,
    priority: ['low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'medium',
    category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : null,
  };
  if (!out.text) return { ok: false, raw, error: 'No task text returned.' };
  return { ok: true, task: out };
}

module.exports = {
  OLLAMA_URL,
  DEFAULT_MODEL,
  aiHealth,
  aiChat,
  aiChatStream,
  aiChatTools,
  aiAbort,
  aiParseTask,
  newRequestId,
};