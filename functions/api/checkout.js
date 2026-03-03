/**
 * Cloudflare Pages Function: /api/checkout
 *
 * Creates a Stripe Checkout Session (no SDK — plain fetch).
 *
 * Env vars:
 *   STRIPE_SECRET_KEY – sk_live_… or sk_test_…
 *   PUBLIC_URL        – public base URL of this deployment
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { priceId, mode = 'subscription' } = body;
  if (!priceId) {
    return new Response(JSON.stringify({ error: 'priceId required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const base = (env.PUBLIC_URL || 'https://blackroad-ai.github.io').replace(/\/$/, '');
  const params = new URLSearchParams({
    mode,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${base}/?checkout=success`,
    cancel_url: `${base}/#pricing`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: data.error?.message || 'Stripe error' }), {
      status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: data.url, id: data.id }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
