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
| LLM Routing | Groq (fast) + Anthropic (complex) |

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

# Data Sources
monte ingest list             # List data sources
monte ingest add -t file -n "My Data"
monte ingest upload file1.txt file2.csv
monte ingest status <id>      # Check processing status

# Configuration
monte config show             # Show configuration
monte config set-api http://api.example.com
monte config dir              # Show config directory
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
- LLM integration via [Groq](https://groq.com/) and [Anthropic](https://anthropic.com/)
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

### Phase 6 (Next)
- [ ] Gmail integration
- [ ] GitHub integration
- [ ] LinkedIn integration
- [ ] Slack integration
- [ ] Webhook notifications

### Future
- [ ] Web UI
- [ ] Custom scenario builder
- [ ] Result visualization exports

---

**Remember: Monte Engine is a flight simulator, not a crystal ball. Use it to understand the range of possible outcomes, not to predict the future.**
