// Vercel serverless function: /api/alternatives
//
// Mirrors the updated carboknot/proxy/index.js#handleAlternatives.
// Gemini-powered sustainable alternatives across 7 merchants with
// Climatiq-validated carbon numbers.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CLIMATIQ_API_KEY = process.env.CLIMATIQ_API_KEY || '';
const CLIMATIQ_API_ENDPOINT =
  process.env.CLIMATIQ_API_ENDPOINT || 'https://api.climatiq.io/data/v1/estimate';
const CLIMATIQ_DATA_VERSION = process.env.CLIMATIQ_DATA_VERSION || '^21';
const CLIMATIQ_DEFAULT_REGION = 'US';
const ALT_TIMEOUT_MS = 12_000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Category → ISIC code (same as proxy).
const CATEGORY_TO_CODE = {
  audio_electronics: '26', laptops: '26', smartphones: '26',
  tablets_displays: '26', gaming_consoles: '26',
  apparel_tops: '14', apparel_bottoms: '14', footwear: '15',
  home_goods: '20', beauty: '20', kitchenware: '20',
  books: '18',
  food_packaged: '10', beverages: '10', pet_supplies: '10',
  furniture: '31', appliances: '27',
  sports_outdoor: '32_sport',
  baby: '32', tools_hardware: '25', watches_jewelry: '32',
  toys: '32', general: '32'
};

// ISIC code → Climatiq activity_id (same as proxy).
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

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function climatiqEstimate(code, money) {
  const activity_id = CLIMATIQ_ACTIVITY_IDS[code] || CLIMATIQ_ACTIVITY_IDS._default;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(CLIMATIQ_API_ENDPOINT, {
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
        parameters: { money, money_unit: 'usd' }
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`climatiq_http_${res.status}`);
    const body = await res.json();
    if (typeof body?.co2e !== 'number' || !body?.emission_factor?.id) {
      throw new Error('malformed_climatiq_response');
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

function buildMerchantUrl(merchant, searchQuery, isUsed, type) {
  switch (merchant) {
    case 'ebay':
      return {
        url: `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}${isUsed ? '&LH_ItemCondition=3000' : ''}`,
        merchantLabel: isUsed ? 'eBay Pre-owned' : 'eBay'
      };
    case 'amazon':
      return {
        url: `https://www.amazon.com/s?k=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Amazon Renewed' : 'Amazon'
      };
    case 'backmarket':
      return {
        url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
        merchantLabel: 'Back Market'
      };
    case 'thredup':
      return {
        url: `https://www.thredup.com/products/search?search_terms=${searchQuery}`,
        merchantLabel: 'ThredUp'
      };
    case 'poshmark':
      return {
        url: `https://poshmark.com/search?query=${searchQuery}&type=listings`,
        merchantLabel: 'Poshmark'
      };
    case 'swappa':
      return {
        url: `https://swappa.com/search?q=${searchQuery}`,
        merchantLabel: 'Swappa'
      };
    case 'walmart':
      return {
        url: `https://www.walmart.com/search?q=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Walmart Renewed' : 'Walmart'
      };
    default:
      if (isUsed) {
        return {
          url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
          merchantLabel: 'Back Market'
        };
      }
      return {
        url: `https://www.google.com/search?q=${searchQuery}+buy&tbm=shop`,
        merchantLabel: type === 'durable' ? 'Brand Direct' : 'Google Shopping'
      };
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  applyCors(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'gemini_unconfigured' });

  const payload = req.body;
  if (!payload || !payload.title || !payload.category) {
    return res.status(400).json({ error: 'bad_payload' });
  }

  const { title, category, price, carbon_kg, site } = payload;
  const priceNum = Number(price) || 0;
  const carbonNum = Number(carbon_kg) || 0;

  const siteCtx = site?.includes('ebay')
    ? 'User is on eBay — prioritise refurbished and pre-owned listings.'
    : site?.includes('amazon')
    ? 'User is on Amazon — mix of energy-efficient new products and certified refurbished.'
    : 'User is shopping online — include refurbished, secondhand and sustainable brands.';

  const merchantList =
    'Back Market, eBay (refurbished/pre-owned), Amazon (renewed/certified), ' +
    'ThredUp, Poshmark, Swappa, Walmart (renewed)';

  const userPrompt =
    `You are a sustainability expert. Return ONLY a raw JSON array (no markdown fences, no commentary).\n\n` +
    `Product: "${title}" | Category: ${category} | Price: $${priceNum} | Carbon: ${carbonNum.toFixed(1)} kg CO₂e\n` +
    `${siteCtx}\n\n` +
    `Suggest 6 specific lower-carbon alternatives. RULES:\n` +
    `- Each MUST be a real, currently purchasable product (exact brand + model).\n` +
    `- Refurbished/renewed/secondhand items are lower carbon because they cost less and avoid new manufacturing.\n` +
    `- Spread across AT LEAST 5 different merchants from: ${merchantList}.\n` +
    `- Do NOT repeat the same merchant more than twice.\n\n` +
    `Each JSON object must have ONLY these keys:\n` +
    `- name: exact brand + full model name (string)\n` +
    `- why: 1-2 sentences explaining which emission stage (manufacturing, shipping, packaging, end-of-life) is reduced and why (string)\n` +
    `- search_query: best search terms to find this exact product on the merchant (string)\n` +
    `- type: one of refurbished, secondhand, efficient, durable (string)\n` +
    `- preferred_merchant: one of backmarket, ebay, amazon, thredup, poshmark, swappa, walmart (string)\n` +
    `- estimated_price_usd: realistic estimated price in USD on this merchant (number)\n\n` +
    `Output raw JSON array only, starting with [ and ending with ].`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const data = await fetchWithTimeout(geminiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } }
      })
    }, ALT_TIMEOUT_MS);

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!raw) throw new Error('empty_gemini_response');

    let parsed;
    try { parsed = JSON.parse(raw); } catch { /* will try regex below */ }
    if (!Array.isArray(parsed)) {
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (arrMatch) { try { parsed = JSON.parse(arrMatch[0]); } catch { /* noop */ } }
    }
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object') {
        parsed = parsed.alternatives || parsed.items || parsed.data || Object.values(parsed).find(Array.isArray);
      }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('no_valid_json_array');

    // Carbon comes ONLY from Climatiq — no carbon_factor from Gemini.
    const filteredAlts = parsed
      .filter(a => a && typeof a.name === 'string')
      .slice(0, 6);

    const code = CATEGORY_TO_CODE[category] || CATEGORY_TO_CODE.general || '32';

    // Carbon = ALWAYS Climatiq spend-based (proportional to price).
    const alternatives = await Promise.all(filteredAlts.map(async (a) => {
      const sq = encodeURIComponent(a.search_query || a.name);
      const isUsed = a.type === 'refurbished' || a.type === 'secondhand';
      const merchant = String(a.preferred_merchant || '').toLowerCase().trim();

      const priceEst = (typeof a.estimated_price_usd === 'number' && a.estimated_price_usd > 0)
        ? Math.round(a.estimated_price_usd)
        : Math.round(isUsed ? priceNum * 0.55 : priceNum * 0.9);

      const { url, merchantLabel } = buildMerchantUrl(merchant, sq, isUsed, a.type);

      let altCarbon;
      let carbonSource;
      if (CLIMATIQ_API_KEY) {
        try {
          const est = await climatiqEstimate(code, priceEst);
          altCarbon = est.co2e;
          carbonSource = 'climatiq';
        } catch { /* fall through to proportional */ }
      }
      if (altCarbon == null) {
        const priceRatio = priceNum > 0 ? priceEst / priceNum : 0.5;
        altCarbon = carbonNum * priceRatio;
        carbonSource = 'price_proportional';
      }

      return {
        name: String(a.name).slice(0, 120),
        merchant: merchantLabel,
        price_usd: priceEst,
        carbon_kg: altCarbon,
        carbon_saved_kg: carbonNum - altCarbon,
        url,
        rationale: String(a.why || '').slice(0, 400),
        type: a.type || 'efficient',
        carbon_source: carbonSource
      };
    }));

    const valid = alternatives.filter(a => a.carbon_saved_kg > 0);
    if (valid.length === 0) throw new Error('no_valid_alternatives');

    return res.status(200).json({ alternatives: valid, source: 'gemini' });
  } catch (err) {
    console.warn('[api/alternatives]:', err?.message || err);
    return res.status(503).json({ error: 'alternatives_unavailable' });
  }
}
