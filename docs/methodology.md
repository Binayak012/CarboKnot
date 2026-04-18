# Ledger Methodology — v0.1

Two pages. Plain language. This is the *d_model* claim: we name our failure modes.

## 1. What we compute

For every product page you open on Amazon or eBay, Ledger estimates the
product's lifecycle carbon footprint in **kilograms of CO₂-equivalent** (kg CO₂e).
The estimate decomposes into four stages:

- **Manufacturing** — raw-material extraction, component fabrication, assembly.
- **Shipping** — inbound freight from factory to fulfilment centre plus last-mile delivery.
- **Packaging** — primary and secondary retail packaging.
- **End-of-life** — disposal, recycling, landfill share.

The user-phase (electricity to run the device, wash cycles for apparel, etc.)
is folded into the manufacturing multiplier at the category level. Future
versions will break it out.

## 2. Data sources

We maintain a static lookup table (`engine/lca.json`) keyed by product category.
Each row encodes a `kg_per_usd` intensity factor and a breakdown across the four
stages. Current sources:

- **Ecoinvent v3.9** — consumer electronics category aggregates.
- **Apple / Samsung Product Environmental Reports (2022)** — laptops, phones.
- **DEFRA UK 2023** — apparel.
- **MIT 2013 sneaker LCA** — footwear.
- **US EEIO 2020** — fallback for furnishings, housewares, toys.
- **Our World in Data (2020)** — packaged food.
- **Green Press Initiative (2010)** — printed books.

The computation is fully local. Nothing about your browsing is transmitted
anywhere unless you explicitly click "Why is this lower carbon?" on an
alternative, which invokes the K2 Think reasoning service.

## 3. Confidence math

Every row in `lca.json` carries a `confidence_multiplier` between 0.15 and 0.40.
We report the point estimate *and* a symmetric interval:
`[kg × (1 − m), kg × (1 + m)]`.

When category detection falls through to the `general` fallback, the multiplier
becomes 0.40 (±40%) and the badge displays a **"category uncertain"** tag. We
*widen the interval* rather than produce a sharper false number.

Dashboard-level totals propagate CI by summing per-view widths — a conservative
linear aggregation that likely over-states uncertainty relative to proper
Monte-Carlo. We prefer the pessimistic direction for this indicator.

## 4. Known failure modes

This is where the *d_model* prize is earned: we list what can go wrong.

- **Price-based proxies are lossy.** A $1000 laptop and a $1000 handbag have
  very different real footprints. We partially correct for this via
  category-specific intensities, but the per-SKU variance is still large.
- **Unknown origin.** We assume typical trade routes (sea freight for most,
  air freight for electronics and premium beauty). An actual origin label could
  shift shipping emissions by 5–10× within the same category.
- **Material ambiguity.** "Cotton shirt" vs. "synthetic shirt" have a 2× spread.
  The product title rarely resolves this. We pick a blended assumption and
  report it in the assumptions list.
- **Category-detection false positives.** Our regex detector can misclassify.
  We surface the resolved category in the breakdown panel so the user can see
  and challenge it.
- **Fallback to `general`.** When no pattern matches, we use a weighted
  cross-sector intensity with a 40% CI. This is a deliberately wide interval;
  the badge shows "category uncertain" to flag it.
- **User-phase blur.** We do not currently model per-household electricity mix,
  wash frequency, or device reuse patterns. These vary enormously and are
  opt-in in a future release.
- **Static table ages out.** Grid-electricity carbon intensities drop by roughly
  2–4% per year in the US and EU. The intensities shipped in v0.1 will be
  modestly pessimistic within 18 months; we version the table under
  `methodology_version` so downstream consumers can detect staleness.

## Interpretability surfaces

Every number in the Ledger UI exposes its trace. The badge shows the confidence
width; the breakdown panel shows the exact computation steps; the dashboard
links back here. There is no hidden state in the estimate — if a user
disagrees with an assumption, they can point to the line that caused it.
