/**
 * Cloudflare Pages / Workers entry-point  (_worker.js)
 *
 * Routes:
 *   POST /api/chat      → Ollama proxy (no external AI providers)
 *   POST /api/checkout  → Stripe Checkout session creator
 *   POST /api/webhook   → Stripe webhook receiver (HMAC-verified)
 *   *                   → serve static assets
 *
 * Environment variables (set in Cloudflare dashboard → Settings → Variables):
 *   OLLAMA_URL            – Ollama base URL  (e.g. http://YOUR_SERVER:11434)
 *   OLLAMA_MODEL          – default model    (e.g. llama3.2)
 *   STRIPE_SECRET_KEY     – sk_live_… or sk_test_…
 *   STRIPE_WEBHOOK_SECRET – whsec_…
 *   PUBLIC_URL            – https://blackroad-ai.github.io (or custom domain)
 */

const MENTION_RE = /@(copilot|lucidia|blackboxprogramming|ollama)\b\.?\s*/gi;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── Route handlers ─────────────────────────────────────────────────────────────

async function handleChat(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { message = '', model } = body;
  const prompt = message.replace(MENTION_RE, '').trim();
  if (!prompt) return json({ error: 'Empty prompt' }, 400);

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
    return json({ error: 'Ollama unreachable', detail: String(err) }, 502);
  }

  if (!ollamaRes.ok) {
    const detail = await ollamaRes.text().catch(() => '');
    return json({ error: 'Ollama error', status: ollamaRes.status, detail }, 502);
  }

  return new Response(ollamaRes.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/x-ndjson',
      'X-Powered-By': 'Ollama',
      'X-Provider': 'local',
    },
  });
}

async function handleCheckout(req, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Stripe not configured' }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { priceId, mode = 'subscription' } = body;
  if (!priceId) return json({ error: 'priceId required' }, 400);

  const base = (env.PUBLIC_URL || 'https://blackroad-ai.github.io').replace(/\/$/, '');
  const params = new URLSearchParams({
    mode,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${base}/?checkout=success`,
    cancel_url: `${base}/#pricing`,
  });

  let res;
  try {
    res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (err) {
    return json({ error: 'Stripe unreachable', detail: String(err) }, 502);
  }

  const data = await res.json();
  if (!res.ok) return json({ error: data.error?.message || 'Stripe error' }, res.status);
  return json({ url: data.url, id: data.id });
}

async function handleWebhook(req, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Not configured', { status: 503 });

  const sigHeader = req.headers.get('stripe-signature') || '';
  const rawBody = await req.text();
  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }

  switch (event.type) {
    case 'checkout.session.completed':
      console.log(`[Stripe] Checkout completed: ${event.data.object.id}`);
      break;
    case 'customer.subscription.deleted':
      console.log(`[Stripe] Subscription cancelled: ${event.data.object.id}`);
      break;
    case 'invoice.payment_failed':
      console.log(`[Stripe] Payment failed: invoice=${event.data.object.id}`);
      break;
    default:
      console.log(`[Stripe] Unhandled: ${event.type}`);
  }

  return json({ received: true });
}

// ── Main fetch handler ─────────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/chat' && req.method === 'POST')     return handleChat(req, env);
    if (url.pathname === '/api/checkout' && req.method === 'POST') return handleCheckout(req, env);
    if (url.pathname === '/api/webhook' && req.method === 'POST')  return handleWebhook(req, env);

    // Fall through to static assets.
    // env.ASSETS is provided by Cloudflare Pages and serves static files automatically.
    // The 404 fallback only fires when deployed as a standalone Worker without Pages.
    return env.ASSETS?.fetch(req) ?? new Response('Not found', { status: 404 });
  },
};
