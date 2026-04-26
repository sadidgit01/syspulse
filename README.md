# SysPulse ⚡

> AI-native infrastructure observability. Metrics, logs, anomaly detection, and predictive alerts — in one self-hostable dashboard.

*Live dashboard preview coming soon*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-PostgreSQL-orange)](https://www.timescale.com)
[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript)](https://typescriptlang.org)

---

## What is SysPulse?

Most monitoring tools make you choose between **power and simplicity**. Datadog is powerful but costs $23 per server per month. Grafana + Prometheus is free but takes days to configure and still needs Loki, Alertmanager, and five other tools wired together.

SysPulse is neither. It is a single, self-hostable platform that gives you:

- **Live metrics** — CPU, memory, disk, and network streaming to your browser in real time
- **Log ingestion** — ship application and system logs alongside your metrics
- **AI anomaly detection** — Isolation Forest models trained per agent, not global thresholds
- **Predictive alerts** — Prophet forecasting warns you before disk fills or memory OOMs
- **LLM explanations** — Llama 4 explains every anomaly in plain English via Groq
- **Correlation engine** — automatically links CPU spikes to error logs at the same timestamp
- **One-command agent install** — any machine, any OS, 60 seconds to first data point

No vendor lock-in. No usage limits. Runs on your own infrastructure.

---

## Demo

| Live Dashboard | Fleet Heatmap | AI Anomaly Feed |
|---|---|---|
| *Screenshots coming soon* | *Screenshots coming soon* | *Screenshots coming soon* |

---

## Feature Highlights

### 🖥 Real-Time Monitoring
Every agent streams CPU, memory, disk, and network deltas to the dashboard over WebSocket. The browser keeps a 60-sample ring buffer per agent — charts update the moment a snapshot lands, with zero polling.

### 🤖 Three-Tier AI Layer
SysPulse uses a hybrid AI approach — not just an LLM wrapper.

- **Tier 1 — Rule engine** fires first. Static thresholds, composite conditions, heartbeat checks. Zero ML cost, instant.
- **Tier 2 — ML models** run continuously. Isolation Forest detects anomalies against each agent's own learned baseline. Prophet forecasts when a metric will cross 90%.
- **Tier 3 — LLM explains** only after Tier 1 or 2 fires. Llama 4 (via Groq) receives the anomaly, recent metrics, and correlated log lines — and returns a plain-English root cause hypothesis.

### 📋 Logs + Correlation
Ship system and application logs from any agent. SysPulse stores them in TimescaleDB alongside metrics — same database, so a single SQL query can join a CPU spike with the error logs that fired at the same second. The correlation engine runs every 60 seconds and surfaces these events automatically.

### 🔐 Security First
- JWT access tokens (15-minute expiry) with rotating refresh tokens
- Role-based access control — Admin, Viewer, Alert Manager
- Org-scoped data isolation — multi-tenant from the database schema up
- Invite system for team onboarding
- Full audit log of every auth event, config change, and alert action

### 🔔 Intelligent Alerts
- Static threshold alerts
- Relative alerts (vs. rolling 24h average)
- Predictive alerts from Prophet forecasts
- AI anomaly alerts from Isolation Forest
- Channels: Slack, Email, Discord webhook, custom webhook

### 🛠 Developer Experience
```bash
# Install agent on any machine in one command
npx syspulse-agent install --server https://your-syspulse.com --token <org_token>

# That's it. Machine appears in dashboard within 60 seconds.
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│              Next.js 15 · TypeScript · Tailwind         │
│         WebSocket streaming · Zustand · Recharts        │
└───────────────────────┬─────────────────────────────────┘
                        │ WebSocket / REST
┌───────────────────────▼─────────────────────────────────┐
│                    FastAPI Core                         │
│         Async SQLAlchemy · Redis Pub/Sub · JWT          │
│      Celery workers · Anomaly tasks · Forecast tasks    │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
┌──────────▼──────────┐   ┌──────────▼──────────────────┐
│  PostgreSQL +        │   │          Redis               │
│  TimescaleDB         │   │  Pub/Sub · Cache · Rate limit│
│  Metrics hypertable  │   └─────────────────────────────┘
│  Logs hypertable     │
│  Auth · Audit log    │
└─────────────────────┘
           ▲
           │ HTTP (batched + compressed)
┌──────────┴──────────┐
│    Python Agent      │
│  psutil · httpx      │
│  Runs on any server  │
└─────────────────────┘
```

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, Python 3.11, SQLAlchemy 2.0 async, Alembic |
| Database | PostgreSQL 16 + TimescaleDB (metrics & logs hypertables) |
| Cache / Pub-Sub | Redis 7 |
| Background jobs | Celery + Redis broker |
| Frontend | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| State | Zustand with WebSocket-fed ring buffers |
| AI / ML | scikit-learn (Isolation Forest), Prophet, Groq API (Llama 4) |
| Agent | Python + psutil, batched HTTP delivery, SIGTERM-safe |
| CLI | Node.js + TypeScript (`npx syspulse-agent`) |
| Auth | JWT + rotating refresh tokens, RBAC, bcrypt |
| Infrastructure | Docker Compose, Traefik (prod) |

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- Node.js 20+
- Python 3.11+
- Git

### 1. Clone and configure

```bash
git clone https://github.com/sadidgit01/syspulse.git
cd syspulse
cp .env.example .env
```

Open `.env` and fill in:

```env
POSTGRES_USER=syspulse
POSTGRES_PASSWORD=your_password
POSTGRES_DB=syspulse
DATABASE_URL=postgresql+asyncpg://syspulse:your_password@postgres:5432/syspulse
REDIS_URL=redis://redis:6379
SECRET_KEY=your_64_char_random_secret
GROQ_API_KEY=your_groq_api_key        # Free at console.groq.com
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### 2. Start the database

```bash
docker compose up postgres redis -d
```

### 3. Run migrations

```bash
cd apps/api
python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
```

### 4. Start the API

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Register your account

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword","org_name":"My Org"}'
```

Save the `org_token` from the response.

### 6. Start the frontend

```bash
cd apps/web
npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in.

### 7. Install an agent

```bash
# On any machine you want to monitor:
npx syspulse-agent install \
  --server http://localhost:8000 \
  --token <your_org_token>
```

Or run the Python agent directly for development:

```bash
cd apps/agent/python_agent
# Set SYSPULSE_SERVER and AGENT_TOKEN in .env
python agent.py
```

Your machine appears in the dashboard within seconds.

---

## Project Structure

```
syspulse/
├── apps/
│   ├── api/                 ← FastAPI backend
│   │   ├── app/
│   │   │   ├── models/      ← SQLAlchemy models (multi-tenant)
│   │   │   ├── routers/     ← API endpoints
│   │   │   ├── services/    ← Business logic, AI engine
│   │   │   └── tasks/       ← Celery background tasks
│   │   └── alembic/         ← Database migrations
│   ├── web/                 ← Next.js 15 dashboard
│   │   ├── app/             ← App Router pages
│   │   ├── components/      ← UI components
│   │   ├── hooks/           ← Custom React hooks
│   │   └── lib/             ← WebSocket client, API, store
│   └── agent/
│       └── python_agent/    ← Lightweight metrics agent
└── packages/
    └── cli/                 ← npx syspulse-agent CLI
```

---

## Comparison

| Feature | SysPulse | Datadog | Grafana + Prometheus |
|---|---|---|---|
| Self-hostable | ✅ | ❌ | ✅ |
| Open source | ✅ | ❌ | ✅ |
| Cost | Free | ~$23/host/mo | Free + ops burden |
| Setup time | ~5 minutes | Complex | Hours across 4+ tools |
| AI anomaly detection | ✅ Per-agent ML | ✅ (paid tier) | ❌ |
| Predictive alerts | ✅ Prophet | ✅ (paid tier) | ❌ |
| LLM explanations | ✅ Llama 4 | ❌ | ❌ |
| Metrics + Logs unified | ✅ | ✅ | Needs Loki + wiring |
| One-command agent install | ✅ | ❌ | ❌ |
| Multi-tenant | ✅ | ✅ | ❌ |

---

## Roadmap

- [x] Phase 1 — Core metrics pipeline, WebSocket streaming, live dashboard
- [x] Phase 2 — JWT auth, RBAC, org management, CLI agent installer
- [x] Phase 3 — Log ingestion, live log viewer, correlation engine
- [x] Phase 4 — Isolation Forest anomaly detection, Prophet forecasting, Llama 4 explanations
- [ ] Phase 5 — Go agent rewrite, mTLS, batching, delta encoding
- [ ] Phase 6 — OpenTelemetry tracing, trace viewer
- [ ] Phase 7 — Incident timeline, alert rule builder UI, PWA, one-click cloud deploy

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
git checkout -b feature/your-feature
git commit -m "feat: your feature"
git push origin feature/your-feature
# Open a pull request
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built by <a href="https://github.com/sadidgit01">Sadid</a> · Star ⭐ if SysPulse saved your server
</p>
