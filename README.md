# 🌱 CarboKnot

> **See the carbon cost of everything you buy — and do something about it.**

CarboKnot is a full-lifecycle carbon footprint tracker for your shopping habits. It intercepts purchases at the moment of decision via a browser extension, captures your full transaction history through Knot's API, and gives you a unified dashboard to reflect on your footprint and take real action — offsetting emissions, swapping to greener alternatives, and canceling high-carbon subscriptions.

---

## 🏆 Built at HackPrinceton Spring 2026

**Track:** Environment & Sustainability  
**Sponsors Used:** Knot API · K2 Think V2 · Google Gemini · Dedalus · Orchid

---

## ✨ Features

- **🔴 Real-time carbon badges** — Browser extension injects CO₂e estimates directly onto Amazon product pages before you buy
- **📦 Full purchase history tracking** — Knot's TransactionLink captures completed transactions across Amazon, Walmart, Target, and more via webhooks
- **🔁 Subscription carbon auditing** — Knot's SubManager surfaces the annual carbon cost of recurring services (HelloFresh, Dollar Shave Club, etc.)
- **🤖 AI-powered reasoning** — K2 Think V2 explains *why* a product has a high footprint and *why* the suggested alternative is greener
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
│                  BACKEND API (Dedalus)               │
│  Auth → Categorization → Carbon Calc → Reasoning    │
│                          │                          │
│              ┌───────────┴────────────┐             │
│              ▼                        ▼             │
│        Climatiq API           K2 Think V2           │
│        (CO₂e numbers)      (Why reasoning)          │
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
| Browser Extension | JavaScript (content script) |
| Backend API | Python / FastAPI |
| Hosting | Dedalus |
| Database | PostgreSQL |
| Transaction Data | Knot TransactionLink (webhooks) |
| Subscription Data | Knot SubManager |
| Agentic Shopping | Knot AgenticShopping |
| Carbon Calculation | Climatiq API |
| Carbon Reasoning | K2 Think V2 (LLM360) |
| Generic AI | Google Gemini API |
| Dashboard UI | Orchid |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL
- API keys for: Knot, Climatiq, K2 Think V2, Gemini, Dedalus

### Installation

```bash
# Clone the repo
git clone https://github.com/Binayak012/CarboKnot.git
cd CarboKnot

# Install backend dependencies
pip install -r requirements.txt

# Install extension dependencies
cd extension && npm install
```

### Environment Variables

Create a `.env` file in the root directory:

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

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/carboknot
```

### Running the Backend

```bash
uvicorn main:app --reload
```

### Loading the Browser Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked** and select the `/extension` folder
4. Navigate to any Amazon product page to see it in action

---

## 🔄 How It Works

### The Full Loop

1. **Browse** — User visits an Amazon product page. The extension reads the product title, price, and category from the DOM and calls the backend.
2. **Calculate** — Backend queries Climatiq for a CO₂e estimate, then calls K2 Think V2 to generate a reasoning explanation and greener alternative.
3. **Badge** — Extension injects a carbon badge next to the price showing the footprint, confidence level, and swap suggestion.
4. **Buy** — If the user purchases anyway, Knot's webhook fires and the transaction is saved to the unified database.
5. **Reflect** — The Orchid dashboard shows the user's cumulative footprint, top-emitting categories, and subscription carbon costs.
6. **Act** — User can offset emissions, trigger an automatic product swap via Knot's AgenticShopping, or cancel a high-carbon subscription.

### Carbon Calculation Pipeline

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
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── routes/
│   │   ├── carbon.py        # Carbon estimation endpoint
│   │   ├── knot.py          # Knot webhook handler
│   │   └── dashboard.py     # Dashboard data endpoints
│   ├── services/
│   │   ├── climatiq.py      # Climatiq API integration
│   │   ├── k2_reasoning.py  # K2 Think V2 integration
│   │   ├── gemini.py        # Gemini API integration
│   │   └── knot.py          # Knot API client
│   └── models/
│       └── purchase.py      # DB schema
├── extension/
│   ├── manifest.json
│   ├── content.js           # Amazon page injection
│   └── popup/               # Extension popup UI
├── dashboard/               # Orchid frontend
├── requirements.txt
└── README.md
```

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

---

## 👥 Team

Built with 💚 at HackPrinceton Spring 2026.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

- [Knot API](https://knotapi.com) — Transaction linking, SubManager, and AgenticShopping
- [Climatiq](https://climatiq.io) — Carbon emissions data
- [K2 Think V2 / LLM360](https://llm360.ai) — Advanced reasoning model
- [Google Gemini](https://ai.google.dev) — Generative AI
- [Dedalus](https://dedaluslabs.ai) — Backend hosting
- [Orchid](https://orchid.com) — Dashboard UI
- HackPrinceton Spring 2026 organizers and mentors
