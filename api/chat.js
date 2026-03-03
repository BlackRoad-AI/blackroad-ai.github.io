/**
 * POST /api/chat
 *
 * Proxies every chat request — regardless of @mention alias — directly to
 * the configured Ollama instance. No external AI providers are ever used.
 *
 * Recognised aliases (all treated identically → Ollama):
 *   @ollama  @copilot  @lucidia  @blackboxprogramming
 *
 * Environment variables:
 *   OLLAMA_URL   – base URL of Ollama  (default: http://localhost:11434)
 *   OLLAMA_MODEL – model to use        (default: llama3.2)
 *
 * Deployed on: Vercel Edge Runtime / Cloudflare Workers / Railway
 */

export const config = { runtime: 'edge' };

const MENTION_RE = /@(copilot|lucidia|blackboxprogramming|ollama)\b\.?\s*/gi;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { message = '', model } = body;

  // Strip every @mention alias — they all route to Ollama regardless
  const prompt = message.replace(MENTION_RE, '').trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Empty prompt after stripping mentions' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const ollamaModel = model || process.env.OLLAMA_MODEL || 'llama3.2';

  let ollamaRes;
  try {
    ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, prompt, stream: true }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Ollama unreachable', detail: String(err) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  if (!ollamaRes.ok) {
    const text = await ollamaRes.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: 'Ollama error', status: ollamaRes.status, detail: text }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  // Stream the NDJSON response from Ollama straight back to the client
  return new Response(ollamaRes.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/x-ndjson',
      'X-Powered-By': 'Ollama',
      'X-Provider': 'local',
    },
  });
}
