// Persona desktop shell — client-side cloud fallback (Tier-2, basic mode).
//
// When the backend (and the local model behind it) is unreachable, the
// renderer's BackendClient flips to basic mode and routes user turns here
// via the 'persona:fallback-chat' IPC channel. We call the configured
// cloud provider directly from the MAIN process so:
//   - API keys never live in the renderer (read from userData),
//   - no browser CORS dance,
//   - keys are never committed (per-device, in violet-settings.json).
//
// Supports two providers, configurable from Tray → Offline Mode Settings:
//   openai  → api.openai.com        (gpt-4o-mini)
//   gemini  → generativelanguage… OpenAI-compat endpoint (gemini-2.5-flash)
//
// Basic mode is talk-only: no tools, no function-calling, no memory.

'use strict';

const { loadSettings } = require('./userSettings');

const PROVIDERS = {
  openai: {
    url:   'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    keyFn: (s) => (s && s.openaiApiKey) || process.env.OPENAI_API_KEY || '',
  },
  gemini: {
    // Gemini exposes an OpenAI-compatible REST surface — same request shape,
    // same response shape, different base URL and key.
    url:   'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.5-flash',
    keyFn: (s) => (s && s.geminiApiKey) || process.env.GEMINI_API_KEY || '',
  },
};

function _resolveProvider() {
  const s        = loadSettings() || {};
  const id       = (s.fallbackProvider && PROVIDERS[s.fallbackProvider])
                   ? s.fallbackProvider
                   : 'openai';
  const provider = PROVIDERS[id];
  const key      = provider.keyFn(s).trim();
  return { id, provider, key };
}

function hasApiKey() {
  const { key } = _resolveProvider();
  return !!key;
}

// Run one basic-mode completion. Returns { text } on success or
// { error } on failure — never throws.
async function runFallbackChat({ messages, model } = {}) {

  const { id, provider, key } = _resolveProvider();

  if (!key) {
    return { error: 'no-api-key' };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'no-messages' };
  }

  try {

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:       model || provider.model,
        messages,
        max_tokens:  220,
        temperature: 0.85,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[fallbackChat] ${id} ${res.status}:`, detail.slice(0, 300));
      return { error: `${id}-${res.status}` };
    }

    const data = await res.json();
    const text =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    return { text: (text || '').trim() };

  } catch (err) {

    console.error('[fallbackChat] request failed:', err && err.message);
    return { error: (err && err.message) || String(err) };

  }

}

module.exports = {
  runFallbackChat,
  hasApiKey,
};
