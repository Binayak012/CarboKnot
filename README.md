# 🌱 CarboKnot

> **See the carbon cost of everything you buy — and do something about it.**

CarboKnot is a full-lifecycle carbon footprint tracker for your shopping habits. It intercepts purchases at the moment of decision via a browser extension, captures your full transaction history through Knot's API, and gives you a unified dashboard to reflect on your footprint and take real action — offsetting emissions, swapping to greener alternatives, and canceling high-carbon subscriptions.

---

## 🏆 Built at HackPrinceton Spring 2026

**Track:** Environment & Sustainability  
**Sponsors Used:** Knot API · K2 Think V2 · Google Gemini · Dedalus · Orchid · Climatiq

---

## ✨ Features

- **🔴 Real-time carbon badges** — Browser extension injects CO₂e estimates directly onto Amazon product pages before you buy
- **📦 Full purchase history tracking** — Knot's TransactionLink captures completed transactions across Amazon, Walmart, Target, and more via webhooks
- **🔁 Subscription carbon auditing** — Knot's SubManager surfaces the annual carbon cost of recurring services (HelloFresh, Dollar Shave Club, etc.)
- **🤖 AI-powered reasoning** — K2 Think V2 explains *why* a product has a high footprint and *why* the suggested alternative is greener, using advanced chain-of-thought reasoning
- **🌿 Greener alternative suggestions** — Every purchase gets a lower-carbon swap recommendation
- **⚡ One-click actions** — Offset emissions via verified providers, swap products via Knot's AgenticShopping, or cancel high-carbon subscriptions
- **📊 Unified dashboard** — Orchid-powered UI shows your footprint over time, by category, and with month-over-month trends

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   DATA SOURCES                       │
│  ┌──────────────────┐    ┌────────────────────────┐  │
│  │ Browser Extension│    │       Knot API         │  │
│  │ (Amazon DOM)     │    │ (Webhooks + SubManager)│  │
│  └────────┬─────────┘    └───────────┬────────────┘  │
└───────────┼──────────────────────────┼───────────────┘
            │                          │
            ▼                          ▼
┌─────────────────────────────────────────────────────┐
│              BACKEND API (TypeScript / Dedalus)      │
│  Auth → Categorization → Carbon Calc → Reasoning    │
│                          │                          │
│              ┌───────────┴────────────┐             │
│              ▼                        ▼             │
│        Climatiq API           K2 Think V2           │
│        (CO₂e numbers)    (Why reasoning layer)      │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│              UNIFIED DATABASE                        │
│  purchases · subscriptions · alternatives · offsets  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│           OUTPUT & ACTION LAYER (Orchid)             │
│  Dashboard · Offset · Swap (AgenticShopping) · Cancel│
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript / JavaScript |
| Browser Extension | JavaScript (content script, DOM injection) |
| Backend API | TypeScript / Node.js |
| Hosting | Dedalus |
| Transaction Data | Knot TransactionLink (webhooks) |
| Subscription Data | Knot SubManager |
| Agentic Shopping | Knot AgenticShopping |
| Carbon Calculation | Climatiq API |
| Carbon Reasoning | K2 Think V2 (LLM360) |
| Generic AI / Categorization | Google Gemini API |
| Dashboard UI | Orchid |
| MCP Integration | `.mcp.json` |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- API keys for: Knot, Climatiq, K2 Think V2, Gemini, Dedalus

### Installation

```bash
# Clone the repo
git clone https://github.com/Binayak012/CarboKnot.git
cd CarboKnot

# Install dependencies
cd carboknot && npm install
```

### Environment Variables

Create a `.env` file in the `carboknot/` directory:

```env
# Knot API
KNOT_API_KEY=your_knot_api_key
KNOT_CLIENT_ID=your_client_id

# Carbon APIs
CLIMATIQ_API_KEY=your_climatiq_key

# AI Models
K2_API_KEY=your_k2_think_v2_key
K2_BASE_URL=your_k2_endpoint
GEMINI_API_KEY=your_gemini_key

# Dedalus
DEDALUS_API_KEY=your_dedalus_key
```

### Running the App

```bash
npm run dev
```

### Loading the Browser Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked** and select the extension folder
4. Navigate to any Amazon product page to see the carbon badge in action

---

## 🔄 How It Works

### The Full Loop

1. **Browse** — User visits an Amazon product page. The extension reads the product title and price from the DOM and calls the backend.
2. **Calculate** — Backend queries Climatiq for a CO₂e estimate.
3. **Reason** — K2 Think V2 explains *why* the product has that footprint and suggests a greener alternative with a chain-of-thought explanation.
4. **Badge** — Extension injects a carbon badge next to the price showing the footprint and swap suggestion.
5. **Buy** — If the user purchases anyway, Knot's webhook fires and the transaction is saved to the unified database.
6. **Reflect** — The Orchid dashboard shows the user's cumulative footprint, top-emitting categories, and subscription carbon costs.
7. **Act** — User can offset emissions, trigger an automatic product swap via Knot's AgenticShopping, or cancel a high-carbon subscription.

### Carbon + Reasoning Pipeline

```
Product Name + Price + Merchant
        │
        ▼
  Climatiq API ──► CO₂e number (kg)
        │
        ▼
  K2 Think V2 ──► Why it's high + Why alternative is lower
        │
        ▼
  Saved to DB + Shown in badge/dashboard
```

### K2 Think V2 Reasoning Example

For a product like *"Gillette Fusion5 Razor Cartridges (8-pack)"*, K2 Think V2 generates:

```json
{
  "why_original_high": "Plastic razor cartridges require petroleum-based manufacturing and generate significant non-recyclable waste.",
  "why_alternative_lower": "A stainless steel safety razor is manufactured once and uses recyclable blades, drastically reducing lifetime waste and emissions.",
  "lifecycle_note": "The safety razor's higher upfront manufacturing carbon is offset within 2-3 months of use."
}
```

---

## 📁 Project Structure

```
CarboKnot/
├── carboknot/           # Main application code
│   ├── src/             # TypeScript source files
│   └── package.json
├── config/              # App configuration
├── docs/                # Documentation
├── .mcp.json            # MCP server integration config
├── .gemini/             # Gemini AI assistant config
├── .gitignore
└── README.md
```

> **Note:** Update this structure to reflect your actual source layout as you build.

---

## 🌍 Impact

CarboKnot makes the invisible visible. The average American generates **~16 tonnes of CO₂** per year, with a significant portion coming from consumer goods. By surfacing carbon costs at the moment of purchase and making greener alternatives one click away, CarboKnot turns passive awareness into active behavior change.

**Key stats our dashboard surfaces:**
- Your top 3 carbon-emitting product categories
- Monthly CO₂e trend (are you improving?)
- Annual subscription carbon cost
- Total CO₂e offset through the platform

---

## 🔮 What's Next

- Expand beyond Amazon to all Knot-supported merchants
- Smarter alternative matching using product embeddings
- Household/team mode for collective accountability
- Monthly carbon budget setting with nudge alerts
- Mobile app with receipt scanning via Gemini Vision
- B2B sustainability reporting for SMEs

---

## 👥 Team

Built with 💚 at HackPrinceton Spring 2026.

<!-- TODO: Add team member names and GitHub handles -->

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements & Credits

This project was built during HackPrinceton Spring 2026 using the following third-party services and frameworks. All significant application logic, architecture, and integration code was written by our team during the hackathon.

| Tool | Role | Link |
|---|---|---|
| Knot API | Transaction linking, SubManager, AgenticShopping | [knotapi.com](https://knotapi.com) |
| Climatiq | Carbon emissions calculation | [climatiq.io](https://climatiq.io) |
| K2 Think V2 / LLM360 | Advanced reasoning model for carbon explanations | [llm360.ai](https://llm360.ai) |
| Google Gemini | Product categorization and generative AI | [ai.google.dev](https://ai.google.dev) |
| Dedalus | Backend hosting and agent infrastructure | [dedaluslabs.ai](https://dedaluslabs.ai) |
| Orchid | Dashboard UI framework | [orchid.com](https://orchid.com) |

HackPrinceton Spring 2026 organizers, mentors, and sponsors.
