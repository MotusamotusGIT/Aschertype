(function () {
  // ---- AI disabled short-circuit ----
  // When AI_CONFIG.enabled isn't explicitly true, expose a no-op window.AI
  // so every caller (assistant panel, ✨ parser, home widget, etc.) sees
  // `available === false` and reports "AI is disabled right now." instead
  // of trying to reach an endpoint.
  const _cfg = () => (typeof window.AI_CONFIG === 'object' && window.AI_CONFIG) || {};
  if (_cfg().enabled !== true) {
    const MSG = 'AI is disabled right now.';
    const disabledResult = () => ({ ok: false, error: MSG, disabled: true });
    window.AI = {
      available: false,
      disabled: true,
      transport: 'disabled',
      health:    async () => ({ ok: false, error: MSG, disabled: true }),
      chat:      async () => disabledResult(),
      chatTools: async () => disabledResult(),
      parseTask: async () => disabledResult(),
      abort:     async () => ({ ok: false, disabled: true }),
      chatStream: async () => ({ requestId: 'disabled_' + Date.now(), disabled: true }),
      onChunk:   () => () => {},
      onDone:    () => () => {},
      abortAll:  () => {},
    };
    return;
  }
  // ---- end disabled short-circuit ----

  const hasNativeAI = typeof window.ai !== 'undefined' && typeof window.ai.chat === 'function';

  if (hasNativeAI) {
    window.AI = {
      available: true,
      health:      window.ai.health,
      chat:        window.ai.chat,
      chatTools:   window.ai.chatTools,
      parseTask:   window.ai.parseTask,
      abort:       window.ai.abort,
      chatStream:  window.ai.chatStream,
      onChunk:     window.ai.onChunk,
      onDone:      window.ai.onDone,
    };
    return;
  }

  const DEFAULT_MODEL = 'qwen2.5:3b';
  const controllers = new Map();
  const chunkListeners = new Set();
  const doneListeners = new Set();

  const cfg = () => window.AI_CONFIG || {};
  const base = () => (cfg().baseUrl || '').replace(/\/+$/, '');
  const configured = () => !!base() && base().indexOf('YOUR-TUNNEL') === -1;

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (cfg().apiKey) h.Authorization = 'Bearer ' + cfg().apiKey;
    return h;
  }

  function newId() {
    return 'web_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function errText(err) {
    return (err && err.message) ? err.message : 'Could not reach the AI server.';
  }

  async function post(path, body, id) {
    const ctrl = new AbortController();
    if (id) controllers.set(id, ctrl);
    try {
      return await fetch(base() + path, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      if (id && !body.stream) controllers.delete(id);
    }
  }

  async function health(model) {
    if (!configured()) return { ok: false, error: 'AI server not configured' };
    try {
      const res = await fetch(base() + '/api/tags', { headers: headers() });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      const wanted = model || DEFAULT_MODEL;
      const names = (data.models || []).map((m) => m.name);
      return { ok: true, hasDefault: names.some((n) => n === wanted || n.startsWith(wanted + ':')), checkedModel: wanted };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  }

  async function chat(messages, options, model) {
    try {
      const res = await post('/api/chat', { model: model || DEFAULT_MODEL, messages, stream: false, options: options || {} });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      return { ok: true, text: (data.message && data.message.content) || '' };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  }

  async function chatTools(messages, tools, options, requestId, model) {
    try {
      const res = await post('/api/chat', { model: model || DEFAULT_MODEL, messages, tools, stream: false, options: options || {} }, requestId);
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      return { ok: true, message: data.message || {} };
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, aborted: true };
      return { ok: false, error: errText(err) };
    }
  }

  async function parseTask(raw) {
    const today = new Date().toISOString().slice(0, 10);
    const messages = [
      {
        role: 'system',
        content: 'Extract a task from the user text. Reply with JSON only: {"text": string, "desc": string, "due": "YYYY-MM-DD" or "", "priority": "low"|"medium"|"high", "category": string}. Today is ' + today + '. Use empty strings when unknown.',
      },
      { role: 'user', content: raw },
    ];
    try {
      const res = await post('/api/chat', { model: DEFAULT_MODEL, messages, stream: false, format: 'json', options: { temperature: 0.1 } });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const data = await res.json();
      const content = (data.message && data.message.content) || '';
      let task;
      try { task = JSON.parse(content); } catch (e) { return { ok: false, error: 'Invalid JSON', raw: content }; }
      if (!['low', 'medium', 'high'].includes(task.priority)) task.priority = 'medium';
      if (task.due && !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) task.due = '';
      return { ok: true, task };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  }

  async function abort(id) {
    const ctrl = controllers.get(id);
    if (ctrl) { ctrl.abort(); controllers.delete(id); }
    return { ok: !!ctrl };
  }

  function emit(set, payload) {
    set.forEach((fn) => { try { fn(payload); } catch (e) { console.warn('[AI] listener error', e); } });
  }

  async function runStream(requestId, messages, options, model) {
    try {
      const res = await post('/api/chat', { model: model || DEFAULT_MODEL, messages, stream: true, options: options || {} }, requestId);
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch (e) { continue; }
          const chunk = obj.message && obj.message.content;
          if (chunk) emit(chunkListeners, { requestId, chunk });
        }
      }
      emit(doneListeners, { requestId });
    } catch (err) {
      if (err && err.name === 'AbortError') emit(doneListeners, { requestId });
      else emit(doneListeners, { requestId, error: errText(err) });
    } finally {
      controllers.delete(requestId);
    }
  }

  async function chatStream(messages, options, model) {
    const requestId = newId();
    setTimeout(() => runStream(requestId, messages, options, model), 0);
    return { requestId };
  }

  function onChunk(fn) { chunkListeners.add(fn); return () => chunkListeners.delete(fn); }
  function onDone(fn) { doneListeners.add(fn); return () => doneListeners.delete(fn); }

  window.AI = {
    get available() { return configured(); },
    health, chat, chatTools, parseTask, abort, chatStream, onChunk, onDone,
  };
})();