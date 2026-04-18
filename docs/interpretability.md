# Ledger Interpretability Spec — v0.1

*Alignment-minded sustainability tooling names its failure modes and shows its work on every screen. We flag uncertainty instead of hiding it. We widen intervals instead of guessing sharper numbers.*

## The trace object

Every carbon number produced by `engine/carbon.js` carries a `trace` object:

```js
trace = {
  inputs: { title, price, category, origin },
  lookup: {
    source,                // citation string, e.g. "DEFRA UK 2023 apparel category"
    kg_per_usd,
    breakdown_weights      // { manufacturing, shipping, packaging, end_of_life }
  },
  computation: [ /* array of human-readable formula steps */ ],
  confidence: { low, high, width_pct, reason },
  assumptions: [ /* array of strings */ ],
  methodology_version: "ledger-v0.1",
  category_uncertain: <boolean>
}
```

The `computation` array is required to be human-readable: each step should
be reproducible by a user with a calculator. No opaque transforms.

## UI surfaces

| Surface | Location | What it shows |
|---|---|---|
| **Badge** | Amazon/eBay product page | kg ± confidence interval, "category uncertain" tag when applicable |
| **Breakdown panel** | Click the badge | Stage bars + "How was this calculated?" accordion expanding the full trace |
| **Dashboard** | Toolbar → Open dashboard | "How we compute these numbers" section linking to methodology |
| **Settings** | Dashboard → Settings | "Why we might be wrong" link + network allowlist |
| **Fallback tag** | Badge | When category regex falls back to `general`, badge shows "category uncertain" tag |

## Invariants

1. **No hidden state.** If a number is on screen, its provenance is one click away.
2. **Fail loud.** When inputs are uncertain, widen the interval; never narrow it to look confident.
3. **Version everything.** `methodology_version` is stamped on every trace so downstream consumers detect staleness.
4. **Local by default.** Interpretability should not require network access. The trace renders from on-device data.

## d_model claim

Ledger's engine spec requires the trace object from day one. There is no retrofit.
The `computeCarbon` function cannot return a number without also returning the
steps that produced it. The badge cannot render without surfacing the confidence
width. The breakdown panel cannot open without showing assumptions. The failure
modes in `methodology.md` are structural, not marketing copy.
