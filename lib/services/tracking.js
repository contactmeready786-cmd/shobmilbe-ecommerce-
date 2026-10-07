'use strict';
// Server-side conversion events: Facebook Conversions API and TikTok Events API.
// The browser pixel sends the same events with the same event_id, so the platforms count each sale once.
const db = require('../db');
const { fetchJson, sha256 } = require('../util');

function phoneE164(p) { return '88' + String(p || '').replace(/\D/g, '').replace(/^88/, ''); }

async function facebookPurchase(order, settings, req) {
  if (!settings.fb_pixel_id || !settings.fb_capi_token) return;
  const ua = String(req.headers['user-agent'] || '');
  const cookies = String(req.headers.cookie || '');
  const fbp = (cookies.match(/(?:^|;\s*)_fbp=([^;]+)/) || [])[1];
  const fbc = (cookies.match(/(?:^|;\s*)_fbc=([^;]+)/) || [])[1];
  const body = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: order.code,
      action_source: 'website',
      event_source_url: (settings.site_url || '') + '/checkout',
      user_data: {
        ph: [sha256(phoneE164(order.phone))],
        fn: [sha256(String(order.customer_name || '').trim().toLowerCase())],
        ct: order.district ? [sha256(String(order.district).toLowerCase().replace(/\s+/g, ''))] : undefined,
        country: [sha256('bd')],
        em: order.email ? [sha256(order.email.trim().toLowerCase())] : undefined,
        client_ip_address: order.ip || undefined,
        client_user_agent: ua || undefined,
        fbp, fbc,
      },
      custom_data: {
        currency: 'BDT', value: order.total, order_id: order.code,
        content_type: 'product', content_ids: (order.lines || []).map((l) => String(l.product_id)),
        contents: (order.lines || []).map((l) => ({ id: String(l.product_id), quantity: l.qty, item_price: l.price })),
        num_items: (order.lines || []).reduce((n, l) => n + l.qty, 0),
      },
    }],
  };
  if (settings.fb_test_code) body.test_event_code = settings.fb_test_code;
  const r = await fetchJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(settings.fb_pixel_id)}/events?access_token=${encodeURIComponent(settings.fb_capi_token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 4000);
  if (!r.ok) await db.logIntegration('facebook', 'capi_purchase', false, (r.data && r.data.error && r.data.error.message) || r.text, order.code);
}

async function tiktokPurchase(order, settings, req) {
  if (!settings.tiktok_pixel_id || !settings.tiktok_events_token) return;
  const cookies = String(req.headers.cookie || '');
  const ttp = (cookies.match(/(?:^|;\s*)_ttp=([^;]+)/) || [])[1];
  const body = {
    event_source: 'web',
    event_source_id: settings.tiktok_pixel_id,
    data: [{
      event: 'CompletePayment',
      event_time: Math.floor(Date.now() / 1000),
      event_id: order.code,
      user: { phone: sha256('+' + phoneE164(order.phone)), email: order.email ? sha256(order.email.trim().toLowerCase()) : undefined, ip: order.ip || undefined, user_agent: String(req.headers['user-agent'] || ''), ttp },
      page: { url: (settings.site_url || '') + '/checkout' },
      properties: {
        currency: 'BDT', value: order.total, order_id: order.code, content_type: 'product',
        contents: (order.lines || []).map((l) => ({ content_id: String(l.product_id), content_name: l.name, quantity: l.qty, price: l.price })),
      },
    }],
  };
  const r = await fetchJson('https://business-api.tiktok.com/open_api/v1.3/event/track/',
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': settings.tiktok_events_token }, body: JSON.stringify(body) }, 4000);
  if (!r.ok || (r.data && r.data.code !== 0)) await db.logIntegration('tiktok', 'events_purchase', false, (r.data && r.data.message) || r.text, order.code);
}

// Fire both; never let a tracking problem break an order.
async function purchase(order, settings, req) {
  await Promise.allSettled([facebookPurchase(order, settings, req), tiktokPurchase(order, settings, req)]);
}

module.exports = { purchase };
