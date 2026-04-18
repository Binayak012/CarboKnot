// Carboknot — hardcoded lower-carbon alternatives.
//
// Zero-trust invariant: this module performs no scraping, no API calls, and
// no product matching. Every alternative is a hand-authored constant. The
// only per-call math is the carbon reduction, derived from the original
// kg estimate and a fixed reduction factor:
//
//   reductionFactor = 0.4   →  refurbished / secondhand
//                              (avoids ~60% of manufacturing emissions)
//   reductionFactor = 0.6   →  B Corp / durable / concentrate alternatives
//                              (~40% reduction via longer life or less material)
//
// Prices are hand-picked representative USD values per alternative. The
// panel computes the delta against the original product's price at render
// time, so hardcoded prices can be either cheaper or pricier than the
// item the user is viewing — that is deliberate and realistic.

const REFURB = 0.4;
const DURABLE = 0.6;

const RATIONALE = {
  refurb_electronics:
    'Refurbishing avoids roughly 60% of manufacturing emissions, which dominate the footprint of this category. ' +
    'Shipping and packaging are comparable to a new unit, so the saving is almost entirely in the factory stage.',
  refurb_laptop:
    'A refurbished laptop reuses the existing display, board, and chassis — the three parts that drive ~80% of lifecycle emissions. ' +
    'You are paying for a second useful life of hardware that already paid its carbon debt.',
  secondhand_apparel:
    'Secondhand garments skip the raw-fibre, dyeing, and finishing stages, which together produce most of a garment\'s footprint. ' +
    'The only added emissions are a short resale-shipping leg and light repackaging.',
  durable_apparel:
    'Durable and repairable apparel is designed for many more wears per garment, so the manufacturing footprint is amortised across a longer life. ' +
    'A B Corp supply chain also uses lower-impact materials and transport than the category average.',
  secondhand_footwear:
    'Pre-owned shoes avoid a second round of sole moulding, upper assembly, and transoceanic shipping. ' +
    'Manufacturing is ~68% of a new pair\'s carbon, and that stage is skipped entirely.',
  durable_footwear:
    'Shoes from low-impact materials (merino, recycled foam) and a B Corp supply chain cut manufacturing emissions substantially. ' +
    'The design also targets a longer wearable life, spreading the remaining footprint across more days of use.',
  concentrate_home:
    'Concentrates and refill pouches ship without the water and plastic bottle that dominate a typical laundry SKU\'s footprint. ' +
    'Reusing one hard bottle across many refills removes the per-purchase packaging emissions almost entirely.',
  refurb_electronics_bcorp:
    'Buying from a certified B Corp electronics reseller means longer warranties and repairable designs, which extends the useful life. ' +
    'A longer life amortises the one-time manufacturing footprint across more years of use.'
};

/**
 * @typedef {Object} Alternative
 * @property {string} name
 * @property {string} merchant
 * @property {number} price_usd
 * @property {number} carbon_kg
 * @property {number} carbon_saved_kg
 * @property {string} url
 * @property {string} rationale
 */

/**
 * Return three hardcoded lower-carbon alternatives for a category.
 * @param {string} category  One of the lca.json category keys.
 * @param {number} originalKg  Original product's kg CO2e, used to derive savings.
 * @returns {Alternative[]}
 */
export function getAlternatives(category, originalKg) {
  const kg = Number.isFinite(originalKg) && originalKg > 0 ? originalKg : 0;
  const mk = (factor, entry) => {
    const carbon_kg = kg * factor;
    return {
      name: entry.name,
      merchant: entry.merchant,
      price_usd: entry.price_usd,
      carbon_kg,
      carbon_saved_kg: kg - carbon_kg,
      url: entry.url,
      rationale: entry.rationale
    };
  };

  const byCategory = {
    audio_electronics: [
      mk(REFURB, {
        name: 'Sony WH-1000XM4 (refurbished)',
        merchant: 'Back Market',
        price_usd: 189,
        url: 'https://www.backmarket.com/en-us/search?q=' + encodeURIComponent('wireless noise cancelling headphones'),
        rationale: RATIONALE.refurb_electronics
      }),
      mk(REFURB, {
        name: 'Certified refurbished headphones',
        merchant: 'eBay Refurbished',
        price_usd: 219,
        url: 'https://www.ebay.com/b/Certified-Refurbished-Headphones/14969/bn_7116879055?_nkw=' + encodeURIComponent('wireless headphones'),
        rationale: RATIONALE.refurb_electronics
      }),
      mk(DURABLE, {
        name: 'House of Marley Positive Vibration XL',
        merchant: 'Local B Corp',
        price_usd: 99,
        url: 'https://www.thehouseofmarley.com/search?q=' + encodeURIComponent('headphones'),
        rationale: RATIONALE.refurb_electronics_bcorp
      })
    ],

    laptops: [
      mk(REFURB, {
        name: 'MacBook Air (refurbished)',
        merchant: 'Back Market',
        price_usd: 799,
        url: 'https://www.backmarket.com/en-us/search?q=' + encodeURIComponent('macbook air'),
        rationale: RATIONALE.refurb_laptop
      }),
      mk(REFURB, {
        name: 'Apple Certified Refurbished MacBook Air',
        merchant: 'Apple Refurbished',
        price_usd: 929,
        url: 'https://www.apple.com/shop/refurbished/mac/macbook-air',
        rationale: RATIONALE.refurb_laptop
      }),
      mk(DURABLE, {
        name: 'Framework Laptop 13 (modular, repairable)',
        merchant: 'Framework',
        price_usd: 1099,
        url: 'https://frame.work/marketplace/laptops',
        rationale: RATIONALE.refurb_electronics_bcorp
      })
    ],

    apparel_bottoms: [
      mk(REFURB, {
        name: "Pre-owned Levi's 501",
        merchant: 'ThredUp',
        price_usd: 28,
        url: 'https://www.thredup.com/products/search?search_terms=' + encodeURIComponent('levis 501 jeans'),
        rationale: RATIONALE.secondhand_apparel
      }),
      mk(REFURB, {
        name: 'Resold designer denim',
        merchant: 'Poshmark',
        price_usd: 35,
        url: 'https://poshmark.com/search?query=' + encodeURIComponent('levis 501 jeans') + '&type=listings',
        rationale: RATIONALE.secondhand_apparel
      }),
      mk(DURABLE, {
        name: 'Patagonia Iron Forge Hemp jeans',
        merchant: 'Patagonia Worn Wear',
        price_usd: 99,
        url: 'https://wornwear.patagonia.com/search?q=' + encodeURIComponent('jeans'),
        rationale: RATIONALE.durable_apparel
      })
    ],

    footwear: [
      mk(REFURB, {
        name: 'Pre-owned sneakers',
        merchant: 'ThredUp',
        price_usd: 32,
        url: 'https://www.thredup.com/products/search?search_terms=' + encodeURIComponent('sneakers'),
        rationale: RATIONALE.secondhand_footwear
      }),
      mk(REFURB, {
        name: 'Pre-owned Air Force 1',
        merchant: 'eBay Pre-owned',
        price_usd: 55,
        url: 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent('nike air force 1 pre-owned') + '&LH_ItemCondition=3000',
        rationale: RATIONALE.secondhand_footwear
      }),
      mk(DURABLE, {
        name: 'Allbirds Wool Runners',
        merchant: 'Allbirds (B Corp)',
        price_usd: 98,
        url: 'https://www.allbirds.com/collections/mens-shoes?q=' + encodeURIComponent('wool runner'),
        rationale: RATIONALE.durable_footwear
      })
    ],

    home_goods: [
      mk(DURABLE, {
        name: 'Dropps laundry pods (concentrate)',
        merchant: 'Dropps (B Corp)',
        price_usd: 20,
        url: 'https://www.dropps.com/search?q=' + encodeURIComponent('laundry pods'),
        rationale: RATIONALE.concentrate_home
      }),
      mk(DURABLE, {
        name: 'Blueland Laundry Tablets (refill)',
        merchant: 'Blueland (B Corp)',
        price_usd: 25,
        url: 'https://www.blueland.com/search?q=' + encodeURIComponent('laundry'),
        rationale: RATIONALE.concentrate_home
      }),
      mk(DURABLE, {
        name: 'Earth Breeze laundry sheets',
        merchant: 'Earth Breeze',
        price_usd: 16,
        url: 'https://www.earthbreeze.com/search?q=' + encodeURIComponent('laundry'),
        rationale: RATIONALE.concentrate_home
      })
    ]
  };

  const list = byCategory[category];
  if (list) return list;

  return [
    mk(REFURB, {
      name: 'Refurbished version',
      merchant: 'Back Market',
      price_usd: 0,
      url: 'https://www.backmarket.com/en-us/search?q=' + encodeURIComponent('refurbished'),
      rationale: RATIONALE.refurb_electronics
    }),
    mk(REFURB, {
      name: 'Secondhand listing',
      merchant: 'eBay Pre-owned',
      price_usd: 0,
      url: 'https://www.ebay.com/sch/i.html?LH_ItemCondition=3000',
      rationale: RATIONALE.secondhand_apparel
    }),
    mk(DURABLE, {
      name: 'Durable B Corp alternative',
      merchant: 'Local B Corp',
      price_usd: 0,
      url: 'https://www.bcorporation.net/en-us/find-a-b-corp/',
      rationale: RATIONALE.refurb_electronics_bcorp
    })
  ];
}
