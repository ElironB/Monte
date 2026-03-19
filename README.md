# Monte Engine 🎲

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Neo4j](https://img.shields.io/badge/Neo4j-5.x-brightgreen.svg)](https://neo4j.com/)

> **Probabilistic life simulation platform** - A flight simulator for life decisions

Monte Engine is an open-source, self-hostable platform that runs probabilistic life simulations based on behavioral data. Instead of giving you a single prediction, it returns probability distributions showing the range of possible outcomes for any major life decision.

**Not an oracle. A flight simulator for decisions.**

---

## 🎯 What Is Monte Engine?

Monte Engine stress-tests your behavioral tendencies against empirically-grounded world models. It creates 1,000 digital "clones" of you with varied traits, runs them through realistic scenarios, and returns probability distributions of outcomes.

### Key Philosophy

- **❌ NOT an oracle** - doesn't predict the future
- **✅ Flight simulator** - stress-tests behavioral tendencies
- **📊 Returns distributions** - not single-point predictions
- **🔍 Based on revealed data** - not self-reported preferences

### Use Cases

1. **Individual decision support** - Should I quit my job? Start a business? Move cities?
2. **LLM agent decision layer** - Agents call Monte instead of internal reasoning
3. **Autonomous agent safety** - Run simulation before high-stakes actions
4. **Research** - Behavioral patterns at scale

---

## 🚀 Quick Start

### Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Docker](https://docker.com/) (for Neo4j, Redis, MinIO)
- 4GB+ RAM available

### 1. Clone & Install

```bash
git clone https://github.com/ElironB/Monte.git
cd Monte
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

Minimum required variables:
```bash
NEO4J_PASSWORD=your_secure_password
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

### 3. Start Infrastructure

```bash
docker-compose up -d neo4j redis minio
```

### 4. Start the Server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`
Documentation at `http://localhost:3000/docs`

### 5. Ingest Your Data

Put your data files in a folder (Google Takeout exports, Obsidian vault, transaction CSVs, etc.):

```bash
monte ingest ./my-data
```

### 6. Connect Platforms (Optional)

Optionally connect your data platforms for richer behavioral data:

```bash
monte connect                # Select platforms interactively
# Open each link in your browser to authorize
monte connect confirm        # Verify connections
```

Or skip this and use file-based ingestion only.

### 7. Build & Simulate

Then build your persona and run simulations:

```bash
monte persona build
monte simulate run -s day_trading
```

---

## 📚 Documentation

### Core Concepts

- [Architecture Overview](#architecture)
- [API Reference](#api-reference)
- [CLI Usage](#cli-usage)
- [Simulation Scenarios](#simulation-scenarios)
- [Contributing](#contributing)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│ 1. DATA INGESTION LAYER                                  │
│ Multi-source connectors → RawSourceData → Signals       │
│ (Search, Social, Financial, Notes, Media)               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 2. SIGNAL EXTRACTION + CONTRADICTION DETECTION           │
│ 5 Extractors → BehavioralSignal[] → Contradictions      │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. PERSONA CONSTRUCTION (GraphRAG → Neo4j)             │
│ DimensionMapper → 6 dimensions → GraphBuilder           │
│ PersonaCompressor → Master Persona                     │
│ CloneGenerator → 1,000 stratified clones               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. SIMULATION ENGINE                                     │
│ Decision Graph + World Agents + LLM Fork Evaluator      │
│ Chaos Injector + Batch Orchestrator                    │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. RESULTS LAYER                                        │
│ Probability distributions → API + CLI output           │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| API Framework | Fastify 5.x + TypeScript |
| Graph Database | Neo4j 5.x |
| Job Queue | BullMQ + Redis |
| Object Storage | MinIO (S3-compatible) |
| Observability | OpenTelemetry + Jaeger |
| LLM Routing | OpenAI SDK (any provider via baseURL) |
| Integrations | Composio (optional platform connections) |

---

## 🔌 API Reference

### Endpoints

#### Persona
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/persona` | Get current persona |
| POST | `/persona` | Build new persona |
| GET | `/persona/history` | View build history |
| GET | `/persona/traits` | Get behavioral traits |

#### Simulations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/simulation` | List simulations (paginated) |
| POST | `/simulation` | Create simulation |
| GET | `/simulation/:id` | Get simulation details |
| GET | `/simulation/:id/results` | Get results |
| GET | `/simulation/:id/progress-rest` | Get progress (REST) |
| GET | `/stream/simulation/:id/progress` | Real-time progress (SSE) |
| DELETE | `/simulation/:id` | Delete simulation |
| GET | `/simulation/scenarios` | List scenarios |

#### Data Sources
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ingestion/sources` | List sources (paginated) |
| POST | `/ingestion/sources` | Register data source |
| POST | `/ingestion/upload` | Upload files |
| GET | `/ingestion/sources/:id` | Get source details |
| GET | `/ingestion/sources/:id/status` | Check status |
| DELETE | `/ingestion/sources/:id` | Delete source |

---

## 💻 CLI Usage

### Installation

```bash
npm install -g .
# or
npm link
```

### Commands

```bash
# Persona
monte persona status          # Check persona status
monte persona build           # Build from data sources
monte persona history         # View build history
monte persona traits          # View behavioral traits

# Simulations
monte simulate list           # List all simulations
monte simulate run -s career_change -n "Job Change" -c 1000
monte simulate progress <id>  # Check progress
monte simulate results <id>   # View results
monte simulate scenarios      # List available scenarios

# Platform Connections (optional)
monte connect                # Interactive platform picker + OAuth links
monte connect confirm        # Verify pending connections
monte connect status         # Show connected platforms

# Data Sources
monte ingest <path>           # Scan directory and ingest all files
monte ingest status           # Show status of all ingestion jobs
monte ingest list             # List data sources
monte ingest delete <id>      # Delete a data source

# Configuration
monte config show             # Show configuration
monte config set-api http://api.example.com
monte config dir              # Show config directory
```

---

## 📊 Data Quality Guide

Not all data is equal. Monte Engine extracts behavioral signals from your files — the richer the data, the more accurate the simulation. Here's what generates the best results, ranked by signal quality:

### 🏆 Tier 1 — Highest Impact (feed these first)

| Data Type | Format | What Monte Extracts | Signals |
|-----------|--------|---------------------|---------|
| **Search History** | JSON (Google Takeout) | Financial intent, career goals, education interests, relocation plans, health focus | `financial_trading`, `career_change`, `education`, `relocation`, `health_fitness` + urgency scoring |
| **Social Media Posts** | JSON (Reddit/Twitter export) | Risk tolerance, emotional state, decision patterns, social engagement | `high_risk_tolerance`, `anxiety`, `decision_paralysis`, `high_social_engagement` |
| **Bank Transactions** | CSV | Spending habits, financial discipline, investment behavior | `impulse_spending`, `budget_struggles`, `active_investor` |

> **Why Tier 1?** These reveal *actual behavior* — what you searched, how you spend, what you post when nobody's watching. This is the "revealed preference" data that Monte was designed for.

### 🥈 Tier 2 — Strong Signal

| Data Type | Format | What Monte Extracts | Signals |
|-----------|--------|---------------------|---------|
| **Personal Notes** | Markdown (Obsidian/Notion export) | Thinking structure, goal-setting patterns, self-awareness depth | `highly_organized` / `freeform_thinker`, `goal_oriented`, `deep_self_reflection` |
| **Watch History** | JSON (YouTube/Netflix Takeout) | Learning style, content preferences, consumption patterns | `educational_content`, `learning_focused`, `high_media_consumption` |

> **Why Tier 2?** Notes and watch history are rich but narrower — they tell Monte *how you think* and *what you consume*, but don't capture the financial/career/emotional signals that Tier 1 data provides.

### 🥉 Tier 3 — Supporting Data

| Data Type | Format | What Monte Extracts |
|-----------|--------|---------------------|
| **PDFs / Documents** | PDF, DOCX | Stored for future extraction (limited current processing) |
| **Images** | PNG, JPG | Stored for future vision-based extraction |
| **Generic Text** | TXT | May trigger various extractors depending on content |

> **Why Tier 3?** These are stored in MinIO but current extractors have limited processing for binary formats. Future versions will add vision and document parsing.

### 💡 Power Move: Contradictions

The **best** simulations come from data that *contradicts itself*. Monte's ContradictionDetector specifically looks for:

- **"I'm disciplined" + overdraft fees** → stated vs revealed gap
- **YOLO posts + budget struggles** → cross-domain contradiction  
- **Goal-oriented notes + repeated failures** → temporal contradiction

These contradictions are what make Monte different from generic personality tests. Feed data from multiple tiers for the richest contradiction detection.

### Where to Get Your Data

| Platform | How to Export | File You Get |
|----------|--------------|-------------|
| Google | [takeout.google.com](https://takeout.google.com) | Search history JSON, YouTube watch history JSON |
| Reddit | [reddit.com/settings/data-request](https://www.reddit.com/settings/data-request) | Posts/comments JSON |
| Twitter/X | Settings → Your Account → Download Archive | tweets.json |
| Bank/Credit Card | Your bank's export feature | transactions.csv |
| Obsidian | Just point at your vault folder | .md files |
| Notion | Settings → Export → Markdown | .md files |
| Spotify | [spotify.com/account/privacy](https://www.spotify.com/account/privacy) | streaming_history.json |

### Quick Test (No Real Data Needed)

```bash
monte ingest tests/fixtures    # Uses built-in sample data
monte persona build
monte simulate run -s day_trading --wait
```

---

## 🎲 Simulation Scenarios

Monte Engine includes 8 pre-built scenarios:

| Scenario | Timeframe | Description |
|----------|-----------|-------------|
| **day_trading** | 12-24 months | Day trading as primary income |
| **startup_founding** | 36-60 months | Tech startup with funding rounds |
| **career_change** | 12-24 months | Industry transition |
| **advanced_degree** | 24-48 months | MBA, PhD, or professional degree |
| **geographic_relocation** | 12-36 months | Move to new city/country |
| **real_estate_purchase** | 60-120 months | Property purchase with mortgage |
| **health_fitness_goal** | 6-18 months | Lifestyle transformation |
| **custom** | variable | Define your own |

---

## 🔧 Configuration

### Environment Variables

```bash
# Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<min 8 chars>
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=<min 1 char>
MINIO_SECRET_KEY=<min 1 char>

# LLM (optional)
GROQ_API_KEY=your_key
ANTHROPIC_API_KEY=your_key

# OpenTelemetry (optional)
OTEL_ENABLED=false
OTEL_SERVICE_NAME=monte-engine
OTEL_EXPORTER_JAEGER_ENDPOINT=http://localhost:14268/api/traces
```

---

## 🚢 Deployment

### Docker Compose (Recommended)

```bash
docker-compose up -d
```

This starts:
- Monte Engine API (port 3000)
- Neo4j (port 7687, 7474)
- Redis (port 6379)
- MinIO (port 9000, 9001)

### Kubernetes

See `k8s/` directory for example manifests (production deployment guide coming soon).

### Environment-Specific Notes

**Development:**
- Uses in-memory volumes
- Auto-reload on code changes
- Debug logging enabled

**Production:**
- Persistent volumes required
- HTTPS recommended
- Rate limiting enabled

---

## 📊 Performance Targets

| Metric | Target |
|--------|--------|
| 1000-clone simulation | < 90 seconds (p95) |
| Persona build | < 5 minutes |
| API response | < 200ms (p95) |
| LLM calls per sim | < 100 |
| Same-input variance | < 5% outcome shift |
| Neo4j queries | < 50ms |
| Concurrent sims | >= 10 |
| Cold start | < 2 minutes |

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/Monte.git

# 2. Install dependencies
npm install

# 3. Start infrastructure
docker-compose up -d neo4j redis minio

# 4. Run in dev mode
npm run dev

# 5. Run tests
npm test
```

### Project Structure

```
Monte/
├── src/
│   ├── api/               # Fastify routes, plugins
│   ├── cli/               # CLI implementation
│   ├── config/            # Database configs
│   ├── ingestion/         # Signal extraction
│   ├── persona/           # Persona construction
│   ├── simulation/        # Simulation engine
│   └── utils/             # Logging, errors
├── tests/                 # Test suite
├── docs/                  # Documentation
├── docker-compose.yml     # Infrastructure
└── package.json
```

---

## 🔒 Security

- **Self-hosted**: No external authentication required - runs locally
- **Rate Limiting**: Per-endpoint rate limits
- **Data Encryption**: All sensitive data encrypted at rest
- **Input Validation**: Zod schemas for all inputs

Please report security vulnerabilities to security@monte-engine.io

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Built with [Fastify](https://fastify.io/), [Neo4j](https://neo4j.com/), [BullMQ](https://bullmq.io/)
- LLM integration via [OpenAI SDK](https://github.com/openai/openai-node) - works with Groq, OpenRouter, OpenAI, Together, and any OpenAI-compatible API
- Inspired by "The Black Swan" and behavioral economics research

---

## 📬 Contact

- **Issues:** [GitHub Issues](https://github.com/ElironB/Monte/issues)
- **Discussions:** [GitHub Discussions](https://github.com/ElironB/Monte/discussions)
- **Twitter:** [@MonteEngine](https://twitter.com/MonteEngine)

---

## 🗺️ Roadmap

### Phase 5 ✅ (Current)
- [x] SSE streaming for progress
- [x] OpenTelemetry tracing
- [x] Self-hosted mode (no auth required)
- [x] CLI interface
- [x] API pagination & caching

### Phase 6 (In Progress)
- [x] Interactive `monte connect` with platform picker
- [x] Composio OAuth integration (Google, Reddit, Spotify, GitHub, Notion, Slack, LinkedIn, Twitter)
- [x] Connection verification (`monte connect confirm`)
- [ ] Webhook notifications

### Future
- [ ] Web UI
- [ ] Custom scenario builder
- [ ] Result visualization exports

---

**Remember: Monte Engine is a flight simulator, not a crystal ball. Use it to understand the range of possible outcomes, not to predict the future.**
