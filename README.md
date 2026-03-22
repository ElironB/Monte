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

Monte Engine stress-tests your behavioral tendencies against empirically-grounded world models. It creates 1,000 digital "clones" of you with varied traits, runs them through realistic scenarios, and returns probability distributions of outcomes — interpreted into natural language narrative analysis, not just numbers.

**Data → Signals → Persona → Clones → Simulation → Narrative Report**

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

## ⚡ Quick Demo (No Real Data Needed)

```bash
# Generate a synthetic persona
monte generate "26 year old software engineer who day trades, impulse spender, anxious about career growth"

# Ingest the generated data
monte ingest ./generated-persona

# Build behavioral persona from signals
monte persona build

# Run simulation from plain English
monte simulate "should I quit my job and day trade with my $80k savings?" --wait

# Generate full report with narrative analysis
monte report <simulation-id>
```

Want to prove personalization works? Generate two different personas and compare:

```bash
monte generate "conservative 40yo accountant, disciplined saver, risk-averse" -o ./persona-conservative
monte generate "25yo crypto trader, YOLO mentality, high risk tolerance" -o ./persona-aggressive
monte compare ./persona-conservative ./persona-aggressive -s day_trading
```

### Custom Scenarios

Describe decisions in plain English by default:

```bash
monte simulate "should I move to Berlin from NYC?" --wait
monte simulate "should I buy this $1300 iPhone or wait?"
monte simulate "is buying a $600k house smart right now?"
```

Need explicit control? Advanced mode still works:

```bash
monte simulate run -s day_trading --wait
monte simulate run -s custom --name "moving-to-berlin" --wait
```

Or explore all built-in scenarios:

```bash
monte simulate scenarios     # List all 8 scenario types
```

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
OPENROUTER_API_KEY=your_key    # recommended: covers both LLM + embeddings
# OR
GROQ_API_KEY=your_key
EMBEDDING_API_KEY=your_key     # required with Groq-only setups
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

**Verify your setup:**
```bash
monte doctor    # Checks all services + API keys
```

### 5. Ingest Your Data

Put your data files in a folder (Google Takeout exports, Obsidian vault, transaction CSVs, etc.):

```bash
monte ingest ./my-data
```

### 6. Connect Platforms (Optional)

⚠️ **Status: Work in Progress** — Composio integration is experimental. Platform connections may be unstable.

Optionally connect your data platforms for richer behavioral data:

```bash
monte connect                # Select platforms interactively
# Open each link in your browser to authorize
monte connect confirm        # Verify connections
```

Powered by [Composio](https://composio.dev/) — get your free API key at composio.dev

**For production use, we recommend file-based ingestion only until Composio integration stabilizes.**

### 7. Build & Simulate

Then build your persona and run simulations:

```bash
monte persona build
monte simulate "should I day trade full time?"
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
│ Signal embeddings + cosine similarity → 6 dimensions   │
│ GraphBuilder → Master Persona → 1,000 stratified clones│
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. SIMULATION ENGINE                                     │
│ Decision Graph + World Agents + LLM Fork Evaluator      │
│ Chaos Injector + Batch Orchestrator                    │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. RESULTS + NARRATIVE LAYER                             │
│ Probability distributions → NarrativeGenerator (LLM)    │
│ → monte report (markdown) → monte compare (A/B)        │
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
| LLM Provider | OpenAI SDK → Groq or OpenRouter (gpt-oss-20b / gpt-oss-120b) |
| Embeddings | OpenAI-compatible embeddings via OpenRouter (`openai/text-embedding-3-small`) |
| Integrations | Composio (optional platform connections) |

---


### Embedding-driven persona mapping

Monte no longer maps signals to dimensions with hardcoded keyword lists. During ingestion, every `Signal` gets an embedding stored on the Neo4j node. During `monte persona build`, the builder compares those vectors against rich behavioral concept descriptions for each dimension and uses cosine similarity to score relevance and direction.

- Default embedding model: `openai/text-embedding-3-small`
- Default provider path: OpenRouter via `OPENROUTER_API_KEY`
- Redis caches static concept vectors for 30 days and signal vectors for 7 days
- Neo4j stores signal embeddings on `Signal.embedding` and creates a native `signal_embedding` vector index
- Groq does not provide embeddings, so Groq-only setups must also set `OPENROUTER_API_KEY` or `EMBEDDING_API_KEY`

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
# Generate synthetic test data (no real data needed)
monte generate "<description>"              # Create synthetic persona from description
monte generate "..." -o ./my-persona        # Custom output directory
monte generate "..." --entries 100          # More data points per file

# Compare personas (A/B testing)
monte compare <dir-a> <dir-b> -s <scenario> # Side-by-side comparison
monte compare ./a ./b -s day_trading -o report.md

# Platform Connections (optional)
# Requires COMPOSIO_API_KEY (free at composio.dev)
monte connect                               # Interactive platform picker + OAuth links
monte connect confirm                       # Verify pending connections
monte connect status                        # Show connected platforms

# Ingest data
monte ingest <path>                         # Scan directory and ingest all files
monte ingest status                         # Show status of all ingestion jobs
monte ingest list                           # List data sources
monte ingest delete <id> --force            # Delete a data source

# Build persona
monte persona build                         # Build from ingested data
monte persona status                        # Check build status
monte persona traits                        # View behavioral dimensions
monte persona history                       # Version history

# Run simulations
monte simulate "should I quit my job and start a business?"   # Natural-language simulation
monte simulate "is buying a $600k house smart right now?"     # Auto-detects scenario + capital
monte simulate run -s day_trading --wait                      # Advanced explicit mode
monte simulate list                         # List all simulations
monte simulate progress <id>                # Check progress
monte simulate results <id>                 # View results
monte simulate results <id> -f json         # JSON output
monte simulate scenarios                    # List available scenarios
monte simulate delete <id> --force          # Delete simulation

# Reports
monte report <id>                           # Generate markdown report
monte report <id> --no-narrative            # Skip LLM narrative
monte report <id> --stdout                  # Print to terminal
monte report <id> -o custom-report.md       # Custom output path

# Health Check
monte doctor                                # Run full setup validation
                                            # Checks: API, Neo4j, Redis, MinIO, LLM key, embedding key

# Configuration
monte config show                           # Show current config
monte config set-api <url>                  # Change API endpoint
monte config set-defaults -s day_trading -c 1000
monte config dir                            # Show config directory
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
| Google | [takeout.google.com](https://takeout.google.com) | Search, Gemini, & YouTube history config (see below) |
| Reddit | [reddit.com/settings/data-request](https://www.reddit.com/settings/data-request) | Posts/comments JSON |
| Twitter/X | Settings → Your Account → Download Archive | tweets.json |
| Bank/Credit Card | Your bank's export feature | transactions.csv |
| Obsidian | Just point at your vault folder | .md files |
| Notion | Settings → Export → Markdown | .md files |
| Spotify | [spotify.com/account/privacy](https://www.spotify.com/account/privacy) | streaming_history.json |

### ⚠️ Crucial: Google Takeout Export Instructions
Google Takeout can export gigabytes of raw, useless system logs if not configured correctly. To get the cleanest, highest-signal data for Monte:

1. **Format MUST be JSON**: In the final step of Takeout, the format is often set to HTML by default. **You MUST change it to JSON**. Monte’s extractors strictly parse JSON arrays and will ignore HTML.
2. **Deselect All**: Click "Deselect All" at the top of the page.
3. **Select "My Activity"**: Click "All activity data included" and only check **Search**, **Discover**, and **Gemini** (or Assistant). This skips heavy ad-click data and system pings.
4. **Select "YouTube and YouTube Music"**: Click "Multiple Formats" or "All YouTube data included" and uncheck everything EXCEPT **history** (viewing/watch history). This skips downloading massive video files or comments.

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

# LLM Provider
OPENROUTER_API_KEY=your_key        # Recommended: one key for LLM + embeddings
# OR
GROQ_API_KEY=your_key              # Groq fast inference for chat completions only
# OR (planned)
# OLLAMA_BASE_URL=http://localhost:11434  # Local Ollama server (coming soon)

# Embeddings
# Auto-uses OPENROUTER_API_KEY when present.
# If you run Groq-only for LLMs, you must also set one of these:
# EMBEDDING_API_KEY=your_key
# EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
# EMBEDDING_MODEL=openai/text-embedding-3-small

# Optional model overrides
# LLM_MODEL=openai/gpt-oss-20b
# LLM_REASONING_MODEL=openai/gpt-oss-120b
# For Ollama (planned): LLM_MODEL=llama3.1:70b

# Composio (optional, experimental)
COMPOSIO_API_KEY=your_key   # Free at composio.dev — WIP, experimental

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

Kubernetes manifests are not yet included. For now, use Docker Compose for deployment.

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
| 1000-clone simulation | ~2 min (OpenRouter) / ~25s (Groq paid) |
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
- **Data Storage**: Data stored locally in Neo4j, Redis, and MinIO — no data leaves your infrastructure
- **Input Validation**: Zod schemas for all inputs

Please report security vulnerabilities via [GitHub Issues](https://github.com/ElironB/Monte/issues) or DM [@ElironK300](https://twitter.com/ElironK300).

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Built with [Fastify](https://fastify.io/), [Neo4j](https://neo4j.com/), [BullMQ](https://bullmq.io/)
- LLM integration via [OpenAI SDK](https://github.com/openai/openai-node) - works with Groq, OpenRouter, OpenAI, Together, and any OpenAI-compatible API
- Monte Carlo simulations adapted from decision science research
- Platform integrations powered by [Composio](https://composio.dev/) (experimental)
- Future local model support via [Ollama](https://ollama.com/)
- Inspired by "The Black Swan" and behavioral economics research

---

## 📬 Contact

- **Issues:** [GitHub Issues](https://github.com/ElironB/Monte/issues)
- **Discussions:** [GitHub Discussions](https://github.com/ElironB/Monte/discussions)
- **Twitter:** [@ElironK300](https://twitter.com/ElironK300)

---

## 🗺️ Roadmap

### Phase 5 ✅
- [x] SSE streaming for progress
- [x] OpenTelemetry tracing
- [x] Self-hosted mode (no auth required)
- [x] CLI interface
- [x] API pagination & caching

### Phase 6 ⚠️ (Experimental)
- [x] Interactive `monte connect` with platform picker
- [x] Composio OAuth integration (Google, Reddit, Spotify, GitHub, Notion, Slack, LinkedIn, Twitter)
- [x] Connection verification (`monte connect confirm`)
- ⚠️ Note: Composio integration is WIP

### Phase 7 ✅
- [x] Quantitative signal extraction (frequency, temporal patterns, trends)
- [x] LLM narrative generation (6-section natural language analysis)
- [x] `monte report` — polished markdown reports with ASCII charts
- [x] `monte generate` — LLM-powered synthetic persona generation
- [x] `monte compare` — A/B persona comparison with divergence analysis

### Phase 8 ✅
- [x] Base Rate Registry with cited empirical data (ESMA, BLS, NCES)
- [x] Kelly Criterion position sizing from simulation data
- [x] Bayesian incremental persona updates (evidence accumulation)

### Phase 9 ✅
- [x] Vector embeddings replace all keyword matching (cosine similarity)
- [x] Natural language simulation queries (`monte simulate "should I..."`)
- [x] Parallel clone execution with rate-limit-safe concurrency
- [x] Startup validation (fail-fast on missing API keys)
- [x] `monte doctor` CLI health check
- [x] End-to-end smoke test (`npm run test:e2e`)

### Future
- [ ] Ollama local model support (run Monte with local LLMs instead of cloud APIs)
- [ ] Web UI
- [ ] Custom scenario builder
- [ ] Composio integration stabilization

---

**Remember: Monte Engine is a flight simulator, not a crystal ball. Use it to understand the range of possible outcomes, not to predict the future.**
