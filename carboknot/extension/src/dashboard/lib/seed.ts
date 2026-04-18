// Demo seed for the dashboard. When the local Dexie DB is empty (e.g. fresh
// install during a demo) we inject ~20 rich, varied product views so the UI
// has something to render. Setting `localStorage.carboknot_seeded = '1'`
// (or wiping local storage via Settings → Reset) re-enables seeding next time.

import type { ViewRow } from './types';

const now = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

function mockTrace(opts: {
  category: string;
  price: number;
  source: ViewRow['data_source'];
  isic4: string;
  activity: string;
  steps: string[];
  assumptions: string[];
  score: number;
}): string {
  return JSON.stringify({
    inputs: { category: opts.category, price_usd: opts.price, currency: 'USD', region: 'US' },
    lookup_source: opts.source,
    data_source: opts.source,
    computation_steps: opts.steps,
    confidence: {
      level: opts.score >= 0.75 ? 'high' : opts.score >= 0.5 ? 'medium' : 'low',
      score: opts.score
    },
    assumptions: opts.assumptions,
    methodology_version: 'v2.4.1',
    isic4_code: opts.isic4,
    climatiq_activity_id: opts.activity
  });
}

export const SEED_VIEWS: ViewRow[] = [
  {
    id: 's01',
    ts: now - 0.5 * HOUR,
    merchant: 'amazon',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    category: 'audio_electronics',
    category_uncertain: false,
    kg_total: 42.3, kg_ci_low: 35.9, kg_ci_high: 48.7, price_usd: 279.99,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'audio_electronics', price: 279.99, source: 'climatiq_fresh',
      isic4: '2640', activity: 'electronics/consumer-electronics/manufacturing',
      steps: [
        '1. Map category audio_electronics → ISIC4 2640',
        '2. Query Climatiq with spend $279.99',
        '3. Apply emission factor 0.151 kg CO₂e/USD',
        '4. Raw: 279.99 × 0.151 = 42.28 kg',
        '5. US regional ×1.001',
        '6. Final: 42.3 kg (CI ±6.4)'
      ],
      assumptions: ['Spend-based LCA', 'US grid mix', 'No EOL credits'],
      score: 0.82
    })
  },
  {
    id: 's02', ts: now - 1 * HOUR, merchant: 'bestbuy',
    title: 'Apple MacBook Pro 14-inch M3 Pro',
    category: 'laptops', category_uncertain: false,
    kg_total: 78.5, kg_ci_low: 68.2, kg_ci_high: 88.8, price_usd: 1999.0,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'laptops', price: 1999, source: 'climatiq_cached',
      isic4: '2620', activity: 'electronics/computers/manufacturing',
      steps: ['Cache hit', 'Factor 0.039', 'Final 78.5 kg'],
      assumptions: ['Cradle-to-gate', 'Battery cells included'], score: 0.79
    })
  },
  {
    id: 's03', ts: now - 1 * DAY - 2 * HOUR, merchant: 'walmart',
    title: 'Samsung 65" QLED 4K TV QN65Q80C',
    category: 'audio_electronics', category_uncertain: false,
    kg_total: 65.1, kg_ci_low: 54.4, kg_ci_high: 75.8, price_usd: 897.0,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'audio_electronics', price: 897, source: 'climatiq_cached',
      isic4: '2640', activity: 'electronics/consumer-electronics/manufacturing',
      steps: ['Cache hit', 'Factor 0.0726', 'Final 65.1 kg'],
      assumptions: ['Display panel mfg', 'Logistics excluded'], score: 0.76
    })
  },
  {
    id: 's04', ts: now - 1 * DAY - 4 * HOUR, merchant: 'amazon',
    title: 'Google Pixel 9 Pro 256GB Obsidian',
    category: 'smartphones', category_uncertain: false,
    kg_total: 55.7, kg_ci_low: 47.8, kg_ci_high: 63.6, price_usd: 999.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'smartphones', price: 999, source: 'climatiq_fresh',
      isic4: '2630', activity: 'electronics/mobile-phones/manufacturing',
      steps: ['Climatiq query', 'Factor 0.0558', 'Final 55.7 kg'],
      assumptions: ['Cradle-to-gate', 'Semi fab energy included'], score: 0.84
    })
  },
  {
    id: 's05', ts: now - 2 * DAY - 1 * HOUR, merchant: 'target',
    title: "Levi's 501 Original Fit Jeans - Dark Indigo",
    category: 'apparel_tops', category_uncertain: false,
    kg_total: 8.1, kg_ci_low: 6.4, kg_ci_high: 9.8, price_usd: 59.99,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'apparel_tops', price: 59.99, source: 'climatiq_cached',
      isic4: '1410', activity: 'apparel/clothing-manufacturing',
      steps: ['Cache hit', 'Factor 0.135', 'Final 8.1 kg'],
      assumptions: ['Cotton cultivation', 'Dye process'], score: 0.71
    })
  },
  {
    id: 's06', ts: now - 2 * DAY - 3 * HOUR, merchant: 'ebay',
    title: 'Nike Air Max 270 Running Shoes Size 11',
    category: 'footwear', category_uncertain: false,
    kg_total: 12.4, kg_ci_low: 9.8, kg_ci_high: 15.0, price_usd: 89.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'footwear', price: 89, source: 'climatiq_fresh',
      isic4: '1520', activity: 'apparel/footwear-manufacturing',
      steps: ['Climatiq query', 'Factor 0.1393', 'Final 12.4 kg'],
      assumptions: ['Rubber sole', 'Transport included'], score: 0.73
    })
  },
  {
    id: 's07', ts: now - 3 * DAY - 1.5 * HOUR, merchant: 'amazon',
    title: 'Atomic Habits: An Easy & Proven Way to Build Good Habits',
    category: 'books', category_uncertain: false,
    kg_total: 1.2, kg_ci_low: 0.9, kg_ci_high: 1.5, price_usd: 14.99,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'books', price: 14.99, source: 'climatiq_cached',
      isic4: '5811', activity: 'media/book-publishing',
      steps: ['Cache hit', 'Factor 0.0801', 'Final 1.2 kg'],
      assumptions: ['Paper production', 'Distribution est'], score: 0.88
    })
  },
  {
    id: 's08', ts: now - 3 * DAY - 5 * HOUR, merchant: 'walmart',
    title: 'Neutrogena Hydro Boost Water Gel Moisturizer',
    category: 'beauty', category_uncertain: false,
    kg_total: 0.8, kg_ci_low: 0.6, kg_ci_high: 1.1, price_usd: 18.97,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'beauty', price: 18.97, source: 'climatiq_cached',
      isic4: '2042', activity: 'manufacturing/cosmetics-toiletries',
      steps: ['Cache hit', 'Factor 0.0421', 'Final 0.8 kg'],
      assumptions: ['Ingredient sourcing', 'Plastic packaging'], score: 0.67
    })
  },
  {
    id: 's09', ts: now - 4 * DAY - 2 * HOUR, merchant: 'target',
    title: 'KIND Bars Variety Pack, Gluten Free, 18 Count',
    category: 'food_packaged', category_uncertain: false,
    kg_total: 3.4, kg_ci_low: 2.6, kg_ci_high: 4.2, price_usd: 22.49,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'food_packaged', price: 22.49, source: 'climatiq_fresh',
      isic4: '1079', activity: 'food/packaged-food-processing',
      steps: ['Climatiq query', 'Factor 0.151', 'Final 3.4 kg'],
      assumptions: ['Ag input emissions', 'Packaging incl'], score: 0.69
    })
  },
  {
    id: 's10', ts: now - 4 * DAY - 7 * HOUR, merchant: 'amazon',
    title: 'HDMI 2.1 Cable 8K 6ft - High Speed 48Gbps',
    category: 'general', category_uncertain: true,
    kg_total: 2.1, kg_ci_low: 1.4, kg_ci_high: 2.8, price_usd: 12.99,
    data_source: 'local_fallback',
    trace: mockTrace({
      category: 'general', price: 12.99, source: 'local_fallback',
      isic4: '2699', activity: 'manufacturing/other-products',
      steps: ['Category uncertain', 'Local fallback factor 0.162', 'Final 2.1 kg'],
      assumptions: ['General merchandise factor', 'Higher uncertainty'], score: 0.41
    })
  },
  {
    id: 's11', ts: now - 5 * DAY - 1 * HOUR, merchant: 'bestbuy',
    title: 'Bose QuietComfort 45 Bluetooth Wireless Headphones',
    category: 'audio_electronics', category_uncertain: false,
    kg_total: 31.8, kg_ci_low: 26.7, kg_ci_high: 36.9, price_usd: 229.0,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'audio_electronics', price: 229, source: 'climatiq_cached',
      isic4: '2640', activity: 'electronics/consumer-electronics/manufacturing',
      steps: ['Cache hit', 'Factor 0.1389', 'Final 31.8 kg'],
      assumptions: ['Li-ion battery mfg', 'Casing included'], score: 0.81
    })
  },
  {
    id: 's12', ts: now - 6 * DAY - 2 * HOUR, merchant: 'walmart',
    title: "Hanes Men's ComfortSoft T-Shirt 6-Pack White",
    category: 'apparel_tops', category_uncertain: false,
    kg_total: 9.7, kg_ci_low: 7.8, kg_ci_high: 11.6, price_usd: 29.98,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'apparel_tops', price: 29.98, source: 'climatiq_cached',
      isic4: '1410', activity: 'apparel/clothing-manufacturing',
      steps: ['Cache hit', 'Factor 0.3235', 'Final 9.7 kg'],
      assumptions: ['Cotton water excl', 'Bangladeshi origin'], score: 0.72
    })
  },
  {
    id: 's13', ts: now - 7 * DAY - 3 * HOUR, merchant: 'amazon',
    title: 'Samsung Galaxy S24 Ultra 256GB Titanium Black',
    category: 'smartphones', category_uncertain: false,
    kg_total: 62.9, kg_ci_low: 53.2, kg_ci_high: 72.6, price_usd: 1199.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'smartphones', price: 1199, source: 'climatiq_fresh',
      isic4: '2630', activity: 'electronics/mobile-phones/manufacturing',
      steps: ['Climatiq query', 'Factor 0.0525', 'Final 62.9 kg'],
      assumptions: ['OLED mfg', 'Titanium frame'], score: 0.83
    })
  },
  {
    id: 's14', ts: now - 9 * DAY - 1.5 * HOUR, merchant: 'amazon',
    title: 'JavaScript: The Good Parts by Douglas Crockford',
    category: 'books', category_uncertain: false,
    kg_total: 0.7, kg_ci_low: 0.5, kg_ci_high: 0.9, price_usd: 8.42,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'books', price: 8.42, source: 'climatiq_cached',
      isic4: '5811', activity: 'media/book-publishing',
      steps: ['Cache hit', 'Factor 0.0831', 'Final 0.7 kg'],
      assumptions: ['Recycled paper assumed', 'Distribution incl'], score: 0.89
    })
  },
  {
    id: 's15', ts: now - 11 * DAY - 4 * HOUR, merchant: 'ebay',
    title: 'Dell XPS 15 9530 Intel Core i9, 32GB RAM, 1TB SSD',
    category: 'laptops', category_uncertain: false,
    kg_total: 71.2, kg_ci_low: 60.8, kg_ci_high: 81.6, price_usd: 1849.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'laptops', price: 1849, source: 'climatiq_fresh',
      isic4: '2620', activity: 'electronics/computers/manufacturing',
      steps: ['Climatiq query', 'Factor 0.0385', 'Final 71.2 kg'],
      assumptions: ['SSD NAND fab', 'Aluminum chassis'], score: 0.8
    })
  },
  {
    id: 's16', ts: now - 13 * DAY - 2 * HOUR, merchant: 'amazon',
    title: 'Anker 65W Fast Charger, USB-C Charging Block',
    category: 'general', category_uncertain: true,
    kg_total: 4.8, kg_ci_low: 3.3, kg_ci_high: 6.3, price_usd: 21.99,
    data_source: 'local_fallback',
    trace: mockTrace({
      category: 'general', price: 21.99, source: 'local_fallback',
      isic4: '2699', activity: 'manufacturing/other-products',
      steps: ['Category ambiguous', 'Local fallback', 'Final 4.8 kg'],
      assumptions: ['PCB mfg excluded', 'GaN tech newer'], score: 0.43
    })
  },
  {
    id: 's17', ts: now - 16 * DAY - 2 * HOUR, merchant: 'amazon',
    title: 'Patagonia Men\'s Better Sweater Fleece Jacket',
    category: 'apparel_tops', category_uncertain: false,
    kg_total: 14.8, kg_ci_low: 11.9, kg_ci_high: 17.7, price_usd: 149.0,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'apparel_tops', price: 149, source: 'climatiq_cached',
      isic4: '1410', activity: 'apparel/clothing-manufacturing',
      steps: ['Cache hit', 'Factor 0.0993', 'Final 14.8 kg'],
      assumptions: ['Recycled poly 51%', 'No verified credit'], score: 0.75
    })
  },
  {
    id: 's18', ts: now - 18 * DAY - 1 * HOUR, merchant: 'amazon',
    title: 'Adidas Ultraboost 23 Running Shoes M 10.5',
    category: 'footwear', category_uncertain: false,
    kg_total: 16.1, kg_ci_low: 12.9, kg_ci_high: 19.3, price_usd: 139.95,
    data_source: 'climatiq_cached',
    trace: mockTrace({
      category: 'footwear', price: 139.95, source: 'climatiq_cached',
      isic4: '1520', activity: 'apparel/footwear-manufacturing',
      steps: ['Cache hit', 'Factor 0.1151', 'Final 16.1 kg'],
      assumptions: ['Primeknit upper', 'Continental rubber'], score: 0.77
    })
  },
  {
    id: 's19', ts: now - 19 * DAY - 4 * HOUR, merchant: 'ebay',
    title: 'Apple iPad Pro 11-inch M4 WiFi 256GB Space Black',
    category: 'laptops', category_uncertain: false,
    kg_total: 47.6, kg_ci_low: 40.2, kg_ci_high: 55.0, price_usd: 999.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'laptops', price: 999, source: 'climatiq_fresh',
      isic4: '2620', activity: 'electronics/computers/manufacturing',
      steps: ['Climatiq query', 'Factor 0.0477', 'Final 47.6 kg'],
      assumptions: ['OLED tandem', 'M4 3nm fab'], score: 0.76
    })
  },
  {
    id: 's20', ts: now - 20 * DAY - 5 * HOUR, merchant: 'bestbuy',
    title: 'Apple iPhone 16 128GB Black (Unlocked)',
    category: 'smartphones', category_uncertain: false,
    kg_total: 57.3, kg_ci_low: 48.4, kg_ci_high: 66.2, price_usd: 799.0,
    data_source: 'climatiq_fresh',
    trace: mockTrace({
      category: 'smartphones', price: 799, source: 'climatiq_fresh',
      isic4: '2630', activity: 'electronics/mobile-phones/manufacturing',
      steps: ['Climatiq query', 'Factor 0.0717', 'Final 57.3 kg'],
      assumptions: ['A18 chip 3nm', 'Reduced packaging'], score: 0.85
    })
  }
];
