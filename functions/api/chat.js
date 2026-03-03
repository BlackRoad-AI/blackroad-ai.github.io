/**
 * Cloudflare Pages Function: /api/chat
 *
 * Proxies every request — regardless of @mention alias — to Ollama.
 * No external AI providers are used.
 *
 * Env vars (Cloudflare dashboard → Settings → Variables):
 *   OLLAMA_URL   – e.g. http://YOUR_SERVER:11434
 *   OLLAMA_MODEL – e.g. llama3.2
 */

const MENTION_RE = /@(copilot|lucidia|blackboxprogramming|ollama)\b\.?\s*/gi;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { message = '', model } = body;
  const prompt = message.replace(MENTION_RE, '').trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Empty prompt' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const ollamaUrl = (env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const ollamaModel = model || env.OLLAMA_MODEL || 'llama3.2';

  let ollamaRes;
  try {
    ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, prompt, stream: true }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Ollama unreachable', detail: String(err) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!ollamaRes.ok) {
    const detail = await ollamaRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'Ollama error', detail }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(ollamaRes.body, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/x-ndjson', 'X-Powered-By': 'Ollama', 'X-Provider': 'local' },
  });
}
