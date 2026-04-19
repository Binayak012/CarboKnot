# 🌱 CarboKnot


A Chrome extension that shows you the carbon cost of anything you're about to buy — calculated on your device, explained by AI, and connected to your full purchase history so you can actually do something about it. The carbon engine runs entirely inside your browser — your purchase data never leaves your device. It intercepts products before you buy, calculates their CO₂e footprint locally, surfaces greener alternatives powered by K2 Think V2 reasoning, and connects to your full purchase history via Knot's API to give you a unified picture of your shopping emissions.

---
# Inspiration 🌍

Every purchase we make—whether it’s electronics, clothing, or household goods—has an environmental cost that most consumers never see. Carbon footprint data usually lives in academic reports or sustainability dashboards, not at the moment when people are actually making purchasing decisions.

Our team wanted to solve this visibility gap. If people could see the carbon impact of a product right before they buy it, they could make more informed and sustainable choices. The idea behind CarboKnot was to bring environmental awareness directly into the shopping experience and empower consumers to understand and reduce their personal carbon footprint.

---

## 🏆 Built at HackPrinceton Spring 2026

**Main Track:** Sustainability

**Sponsors Utilized:** Knot API · K2 Think V2 · Google Gemini · Dedalus · Orchid

---

## ✨ Features

- **🔒 On-device carbon engine** — Carbon calculations run locally inside the extension. No purchase data is sent to external servers without your consent
- **🔴 Real-time carbon badges** — CO₂e estimates injected directly onto Amazon product pages before you click Buy Now
- **📦 Full purchase history** — Knot's TransactionLink captures transactions across Amazon, Walmart, Target, and more via webhooks
- **🔁 Subscription auditing** — Knot's SubManager surfaces the annual carbon cost of recurring services
- **🤖 AI-powered reasoning** — K2 Think V2 explains *why* a product has a high footprint and *why* the suggested alternative is greener, using chain-of-thought reasoning
- **🌿 Greener alternatives** — Every purchase gets a lower-carbon swap suggestion
- **⚡ One-click action** — Offset, swap, or cancel high-carbon subscriptions
- **📊 Unified dashboard** — Interactive UI shows your full footprint, category breakdown, and trends

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          BROWSER                              │
│                                                               │
│   ┌──────────────────────────────────────────────────────┐   │
│   │              carboknot-extension                      │   │
│   │                                                       │   │
│   │  DOM Scraper → Carbon Engine → Badge Injector         │   │
│   │       (on-device · no data leaves browser)            │   │
│   └──────────────────────┬────────────────────────────────┘   │
└─────────────────────────┼─────────────────────────────────────┘
                           │ (opt-in only)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   carboknot-proxy                             │
│   Lightweight middleware · routes to external APIs            │
│                                                               │
│   ┌─────────────┐   ┌─────────────┐   ┌──────────────────┐  │
│   │ Climatiq    │   │ K2 Think V2 │   │   Knot API       │  │
│   │ (CO₂e data) │   │ (Reasoning) │   │ (Transactions +  │  │
│   └─────────────┘   └─────────────┘   │  SubManager)     │  │
│                                        │                  │  │
│                                        └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              UNIFIED DATABASE + ORCHID DASHBOARD              │
│  purchases · subscriptions · alternatives · offsets           │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** The carbon engine (`extension/src/engine/`) is a tested, self-contained module that runs on-device. External API calls are opt-in and routed through the proxy only when richer data is needed.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript / JavaScript |
| Package Manager | pnpm 10.33.0 (workspaces monorepo) |
| Bundler | esbuild |
| Browser Extension | `carboknot-extension` package |
| Proxy / Middleware | `carboknot-proxy` package |
| Carbon Engine | On-device TypeScript module (unit tested) |
| Transaction Data | Knot TransactionLink (webhooks) |
| Subscription Data | Knot SubManager |
| Carbon Data | Climatiq API |
| Carbon Reasoning | K2 Think V2 (LLM360) |
| Generic AI | Google Gemini API |
| Dashboard UI | Orchid |
| Hosting | Vercel |
| MCP Integration | Knot Docs MCP (`docs.knotapi.com/mcp`) |

---

## 🚀 Getting Started


### Installing the extension

```bash
# Clone the repo
git clone https://github.com/Binayak012/CarboKnot.git
cd CarboKnot

# Install all workspace dependencies
pnpm install
```


### Loading the Extension in Chrome

1. Run `pnpm build` to produce the extension bundle
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer Mode**
4. Click **Load unpacked** → select the extension output folder
5. Visit any Amazon product page to see the carbon badge

---

## 🔄 How It Works

### The Full Loop

1. **Browse** — Extension detects an 21+ product pages and reads the product title and price from the DOM
2. **Calculate (on-device)** — The local carbon engine estimates CO₂e from bundled category benchmarks — instant, no network call needed
3. **Enrich (opt-in)** — The proxy calls Climatiq for a precise number and K2 Think V2 for a chain-of-thought explanation
4. **Badge** — Carbon badge injected next to the price with footprint, confidence, and a greener swap suggestion
5. **Buy** — Knot's webhook captures the completed transaction, saved to the unified database
6. **Reflect** — Interactive dashboard shows cumulative footprint, category breakdown, and subscription emissions
7. **Act** — One-click to offset, swap, or cancel a subscription

### Carbon Pipeline
<img width="1091" height="661" alt="Screenshot 2026-04-19 at 4 11 52 AM" src="https://github.com/user-attachments/assets/11326550-3dc7-401f-9457-24b17c32c49b" />

### K2 Think V2 Reasoning Example

```json
{
  "why_original_high": "Plastic razor cartridges require petroleum-based manufacturing and create non-recyclable waste.",
  "why_alternative_lower": "A stainless safety razor is made once; recyclable blades cut lifetime emissions by 70%.",
  "lifecycle_note": "The safety razor's higher upfront carbon is offset within 2–3 months of use."
}
```

---

## 📁 Project Structure

```
CarboKnot/                        ← pnpm monorepo root
├── extension/                    ← carboknot-extension package
│   └── src/
│       ├── engine/
│       │   ├── carbon.ts         ← on-device carbon engine
│       │   └── carbon.test.mjs   ← engine unit tests
│       └── extension.test.mjs    ← integration tests
├── proxy/                        ← carboknot-proxy package
├── config/                       ← shared configuration
├── docs/                         ← documentation
├── .mcp.json                     ← Knot Docs MCP server config
├── opencode.json
└── README.md
```

---

## 🌍 Impact

The average American generates **~16 tonnes of CO₂** per year, with a major share from consumer goods. CarboKnot is a tool to surface that cost at the exact moment of decision — without requiring you to trust a server with your purchase data.

---

## 🔮 What's Next

- Publish to the Chrome Web Store for one-click install
- Expand to Firefox and Edge (WebExtension API compatible)
- Expand merchant coverage to all Knot-supported retailers
- Product embedding-based alternative matching
- Household/team mode for collective carbon accountability
- Monthly carbon budget with nudge alerts

---

## 👥 Team

Built with 💚 at HackPrinceton Spring 2026.

Team Members (in alphabetical order): Anshuraj Sedai, Binayak Subedi, Pranish Uprety, Rahul Mandal
<!-- Add team member names and GitHub handles here -->

---


## 🙏 Credits & Acknowledgements

All application logic, the on-device carbon engine, the monorepo architecture, and all API integrations were written by our team during HackPrinceton Spring 2026. The following third-party tools and services were used:

| Tool | Role | Link |
|---|---|---|
| Knot API | TransactionLink, SubManager, AgenticShopping | [knotapi.com](https://knotapi.com) |
| Climatiq | Carbon emissions data | [climatiq.io](https://climatiq.io) |
| K2 Think V2 / LLM360 | Chain-of-thought carbon reasoning | [huggingface.co/LLM360/K2-Think-V2](https://huggingface.co/LLM360/K2-Think-V2) |
| Google Gemini | Categorization and generative AI | [ai.google.dev](https://ai.google.dev) |
| Dedalus | Proxy hosting | [dedaluslabs.ai](https://dedaluslabs.ai) |
| Orchid | Dashboard UI | [orchid.com](https://www.orchids.app/) |
| esbuild | Extension bundler | [esbuild.github.io](https://esbuild.github.io) |
| pnpm | Monorepo package manager | [pnpm.io](https://pnpm.io) |

HackPrinceton Spring 2026 organizers, mentors, and sponsors.
