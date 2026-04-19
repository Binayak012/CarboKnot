// Vercel serverless function: /api/climatiq
//
// Mirrors carboknot/proxy/index.js#handleClimatiq for Vercel deployment.
// Stateless — no warmer, no on-disk cache. The extension's IndexedDB
// cache in the service worker handles repeat-hit performance.

const CLIMATIQ_API_KEY = process.env.CLIMATIQ_API_KEY || '';
const CLIMATIQ_API_ENDPOINT =
  process.env.CLIMATIQ_API_ENDPOINT || 'https://api.climatiq.io/data/v1/estimate';
const CLIMATIQ_DATA_VERSION = process.env.CLIMATIQ_DATA_VERSION || '^21';
const CLIMATIQ_DEFAULT_REGION = 'US';
const CLIMATIQ_TIMEOUT_MS = 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ISIC4 → Climatiq CEDA 2022 spend-based activity_id.
// Kept in sync with proxy/index.js CLIMATIQ_ACTIVITY_IDS.
const CLIMATIQ_ACTIVITY_IDS = {
  '10': 'food-type_snack_food_manufacturing',
  '14': 'consumer_goods-type_apparel_manufacturing',
  '15': 'consumer_goods-type_leather_and_related_product_manufacturing',
  '18': 'paper_products-type_book_publishers',
  '20': 'chemicals-type_soap_and_cleaning_compound_manufacturing',
  '25': 'machinery-type_machine_tool_manufacturing',
  '26': 'electronics-type_electronic_computer',
  '27': 'electrical_equipment-type_small_electrical_appliances',
  '31': 'consumer_goods-type_institutional_furniture',
  '32': 'consumer_goods-type_doll_toy_and_game_manufacturing',
  '32_sport': 'consumer_goods-type_sporting_athletic_goods',
  _default: 'consumer_goods-type_doll_toy_and_game_manufacturing'
};

function applyCors(res, origin) {
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('access-control-allow-origin', allow);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, accept');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'origin');
}

function validNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  applyCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = req.body;
  if (!payload) {
    res.status(400).json({ error: 'bad_payload' });
    return;
  }

  const code = String(payload.classification_code ?? '').trim();
  const money = payload.money;
  const money_unit = String(payload.money_unit ?? 'usd').toLowerCase();

  if (!code || !validNumber(money) || money <= 0) {
    res.status(400).json({ error: 'bad_payload' });
    return;
  }

  if (!CLIMATIQ_API_KEY) {
    res.status(503).json({ error: 'climatiq_unconfigured', source: 'fallback' });
    return;
  }

  const activity_id = CLIMATIQ_ACTIVITY_IDS[code] || CLIMATIQ_ACTIVITY_IDS._default;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIMATIQ_TIMEOUT_MS);

    const upstream = await fetch(CLIMATIQ_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${CLIMATIQ_API_KEY}`
      },
      body: JSON.stringify({
        emission_factor: {
          activity_id,
          data_version: CLIMATIQ_DATA_VERSION,
          region: CLIMATIQ_DEFAULT_REGION
        },
        parameters: { money, money_unit }
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      throw new Error(`climatiq_http_${upstream.status}`);
    }

    const body = await upstream.json();

    if (typeof body?.co2e !== 'number' || !body?.emission_factor?.id) {
      throw new Error('malformed_climatiq_response');
    }

    res.status(200).json(body);
  } catch (err) {
    console.warn('[api/climatiq] fallback:', err?.name || 'error', err?.message || '');
    res.status(503).json({ error: 'climatiq_unavailable', source: 'fallback' });
  }
}
