# 🚀 VyapaarAI (ArthOS AI)

> ### India's First Autonomous, Context-Aware Business Operating System for Micro-Merchants & Kirana Stores

<p align="center">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-7-purple?logo=vite" alt="Vite 7" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwind-css" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Node.js-Express%205-green?logo=node.js" alt="Node.js Express 5" />
  <img src="https://img.shields.io/badge/PostgreSQL-Drizzle%20ORM-blue?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Languages-12%20Indian%20Languages-orange" alt="12 Indian Languages" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## 🌟 Overview & Problem Statement

Across India, over **13 million micro-merchants and Kirana stores** power the neighborhood retail economy. Yet, the vast majority remain constrained by:
* **Manual Paper Bookkeeping (*Bahi-Khata*)**: Lost slips, uncollected customer credit (*Udhaar*), and calculation errors.
* **Dead Stock & Stockouts**: Inability to forecast product demand based on local weather, seasons, and regional festivals.
* **Complex Digital Software**: Existing enterprise ERPs or POS tools are English-first, desktop-bound, and too complex for busy shop counters.

**VyapaarAI** reimagines the Kirana store workflow by serving as an **always-on, voice-first digital partner**. Shopkeepers can talk in their regional mother tongue, bill items by voice, automate friendly WhatsApp payment reminders, predict stock depletion, and monitor store profitability in real time.

---

## 🛠️ Complete Technology Stack

### Frontend Application (`@workspace/vyapaar-ai`)
* **React 19 & TypeScript**: Component-driven UI with end-to-end type safety.
* **Vite 7**: Ultra-fast bundler with Hot Module Replacement (HMR).
* **Tailwind CSS v4 + Radix UI Primitives**: Indian aesthetic design palette (`saffron`, `marigold`, `paper`, `ink`) with accessible headless UI primitives.
* **Wouter**: Ultralight client-side router (~1.5 KB) optimized for budget mobile devices over low-bandwidth cellular networks.
* **TanStack React Query v5**: Server-state synchronization, background caching, and optimistic UI updates.
* **Framer Motion**: Smooth 60fps gesture animations, drawer transitions, and responsive statistical widgets.
* **Recharts**: Responsive SVG charts for revenue trends, inventory velocity, and weather impact curves.
* **Web Speech Recognition API**: Native voice billing in Hindi, Telugu, Tamil, and other regional accents.
* **Custom i18n Engine**: Zero-overhead context supporting **12 Indian Languages** (Hindi, Telugu, Tamil, Marathi, Bengali, Gujarati, Kannada, Punjabi, Malayalam, Odia, Assamese, English).
* **Google OAuth 2.0 (`@react-oauth/google`)**: One-tap merchant onboarding.

### Backend & Middleware (`@workspace/api-server`)
* **Node.js (ESM) + Express.js 5**: Event-driven high-throughput API gateway.
* **esbuild**: Sub-second bundle compiler outputting clean production ESM artifacts.
* **Dual-Engine Authentication**:
  - Stateless HTTP-only JWT session cookies with 30-day "Remember Me" persistence.
  - Multi-tier OTP delivery pipeline (Twilio SMS + Fast2SMS + Native TLS Gmail SMTP relay + Offline/Dev bypass).
* **Pino + Pino-HTTP**: High-performance JSON logger.

### Database & Storage (`@workspace/db`)
* **PostgreSQL (Render Postgres / Neon / Supabase)**: Relational ACID database ensuring strict consistency for billing, stock, and credit ledgers.
* **Drizzle ORM**: Zero-overhead TypeScript-native query builder and schema definitions.
* **Drizzle-Zod**: Schema synchronization validating incoming HTTP bodies against database models.
* **In-Memory & Persistent JSON Fallback**: Offline-resilient storage mode ensuring the POS counter never halts even during upstream database cold-starts.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🎙️ **Voice-First POS Billing** | Shopkeeper speaks naturally (*"2 packet Maggi aur 1 litre Amul doodh"*); items, quantities, and pricing are auto-added to the invoice in real time. |
| 📊 **Real-time Bahi-Khata (Udhaar)** | Ledger tracking customer credits, repayment timelines, credit trust scores, and outstanding dues. |
| 💬 **Automated WhatsApp Follow-ups** | One-tap friendly credit collection messages with embedded UPI payment links sent via WhatsApp. |
| 📈 **Predictive Demand & Reordering** | Heuristic stock depletion forecasting based on sales velocity, weather forecast, and festival calendar. |
| 🌦️ **Weather & Festival AI Intelligence** | Automatically correlates sunny/rainy days and upcoming festivals (Diwali, Eid, Sankranti) to recommend optimal procurement. |
| 🩺 **Kirana Health Index** | Evaluates store performance across 4 vital pillars: Cash Flow, Inventory Turnover, Udhaar Collection Rate, and Margin Efficiency. |
| 🔐 **Multi-Channel OTP Verification** | Frictionless sign-up and sign-in with instant inline 6-digit phone and email OTP verification. |

---

## 🏗️ Project Architecture & Monorepo Structure

```text
VyapaarAI/
├── artifacts/
│   ├── api-server/             # Express 5 backend API service
│   │   ├── src/
│   │   │   ├── lib/            # SMS, OTP, and Memory stores
│   │   │   ├── middleware/     # JWT authentication & session cookies
│   │   │   └── routes/         # Auth, Inventory, Billing & Health endpoints
│   │   └── build.mjs           # esbuild production bundler
│   │
│   └── vyapaar-ai/             # Vite + React 19 Frontend
│       ├── src/
│       │   ├── auth/           # AuthContext & Session management
│       │   ├── components/     # POS, Dashboard, Analytics & Settings views
│       │   ├── data/           # Business data models & fallback datasets
│       │   └── i18n/           # 12 Indian regional language dictionaries
│       └── vite.config.ts      # Vite configuration & dev proxy
│
├── lib/
│   └── db/                     # Drizzle ORM PostgreSQL schema & migrations
│
├── .env.example                # Template for environment configuration
├── pnpm-workspace.yaml         # Monorepo workspace configuration
├── render.yaml                 # Infrastructure as Code for Render deployment
└── package.json                # Root package configuration
```

---

## 🚀 Quickstart & Local Setup

### 1. Prerequisites
* **Node.js** v20.x or v22.x+
* **pnpm** v10+ (`npm install -g pnpm`)

### 2. Clone the Repository
```bash
git clone https://github.com/Jathin-Devidi/VyapaarAI.git
cd VyapaarAI
```

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Configure Environment Variables
Copy the sample environment file:
```bash
cp .env.example .env
```
Open `.env` and configure your credentials (or test with built-in development defaults):
```env
PORT=10000
VITE_PORT=25694
JWT_SECRET=your_jwt_secret_here

# Email OTP (Optional - Gmail App Password)
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_16_char_password

# SMS Gateway (Optional - Twilio or Fast2SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
FAST2SMS_API_KEY=
```

### 5. Start Development Servers
Run the full application (Frontend + Backend):
```bash
pnpm run dev
```
* **Frontend Application**: `http://localhost:25694`
* **Backend API**: `http://localhost:10000`

*(Tip: In local and test modes, use universal verification code `123456` for instant OTP verification).*

---

## 🌐 Production Deployment (Render)

The repository includes a ready-to-use `render.yaml` blueprint defining:
1. **`vyapaar-api-server`**: Express Node.js web service running production builds.
2. **`vyapaar-ai-frontend`**: Static Vite application with API route rewrites.
3. **`vyapaar-postgres`**: Managed PostgreSQL database.

To deploy:
1. Connect your GitHub repository to [Render](https://render.com).
2. Create a new **Blueprint** and select `render.yaml`.
3. Add your production environment secrets under the service settings.

---

## 👥 Core Team (Quiet Launch)

* **Jathin Devidi**
* **Ayush Devidi**
* **Jashwanth Chary**
* **Sumanth Repala**
* **Saicharan Rai**

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
