/**
 * POST /api/checkout
 *
 * Creates a Stripe Checkout Session and returns the hosted-page URL.
 * No Stripe SDK — uses the Stripe REST API directly via fetch.
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY  – Stripe secret key  (sk_live_… or sk_test_…)
 *   PUBLIC_URL         – Public base URL of this deployment (for redirect URLs)
 *
 * Request body (JSON):
 *   { priceId: "price_…", mode: "subscription" | "payment" }
 */

export const config = { runtime: 'edge' };

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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 503,
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

  const { priceId, mode = 'subscription' } = body;
  if (!priceId) {
    return new Response(JSON.stringify({ error: 'priceId is required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const base = (process.env.PUBLIC_URL || 'https://blackroad-ai.github.io').replace(/\/$/, '');
  const params = new URLSearchParams({
    mode,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${base}/?checkout=success`,
    cancel_url: `${base}/#pricing`,
  });

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Stripe unreachable', detail: String(err) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const data = await stripeRes.json();
  if (!stripeRes.ok) {
    return new Response(JSON.stringify({ error: data.error?.message || 'Stripe error' }), {
      status: stripeRes.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: data.url, id: data.id }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
