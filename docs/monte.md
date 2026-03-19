# Monte Engine - Implementation Status

## Project Overview
Monte Engine is an open-source, self-hostable probabilistic life simulation platform that ingests multi-source personal data, constructs a Personal Knowledge Graph, generates 1,000 behavioral clone variants, and runs them through configurable decision scenarios.

---

## ✅ COMPLETED: Phase 1 - Core Infrastructure (Weeks 1-3)

### Infrastructure
- **Docker Compose**: Neo4j 5.x, Redis 7, MinIO with health checks
- **Fastify API**: TypeScript, JWT/Paseto auth, rate limiting, Swagger/OpenAPI docs
- **Build System**: TypeScript 5.6, tsx for dev, tsc for production

### Database Layer
- **Neo4j**: Connection pooling, query builders, schema initialization with constraints
- **Redis**: Async cache client with type-safe helpers
- **MinIO**: S3-compatible object storage for file uploads

### API Endpoints
| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /auth/register` | - | JWT + refresh token auth |
| `POST /auth/login` | - | Login with password |
| `POST /auth/refresh` | - | Refresh tokens |
| `GET /auth/me` | ✓ | Current user info |
| `GET/PUT/DELETE /users/:id` | ✓ | User CRUD |
| `GET/POST /ingestion/sources` | ✓ | Data source management |
| `POST /ingestion/upload` | ✓ | Base64 file upload |
| `GET /ingestion/sources/:id/status` | ✓ | Check ingestion status |
| `GET/POST /persona` | ✓ | Persona build/management |
| `GET /persona/history` | ✓ | Version history |
| `GET /persona/traits` | ✓ | Behavioral traits |
| `GET /persona/memories` | ✓ | Extracted memories |
| `GET/POST /simulation` | ✓ | Simulation orchestration |
| `GET /simulation/:id/results` | ✓ | Probability distributions |
| `GET /simulation/scenarios` | ✓ | List 8 built-in scenarios |
| `POST /cli/*` | ✓ | Agent-optimized JSON endpoints |
| `GET /health/ready` | - | Readiness probe |

### Queue System (BullMQ)
- **Ingestion Queue**: Signal extraction jobs with retry
- **Persona Queue**: Graph construction jobs
- **Simulation Queue**: Clone batch execution
- **Workers**: Concurrent processing with configurable concurrency

---

## ✅ COMPLETED: Phase 2 - Ingestion Layer (Weeks 4-7)

### Data Types
- **RawSourceData**: Unified interface for all ingestion sources
- **BehavioralSignal**: Extracted behavioral patterns with confidence scores
- **SignalContradiction**: Detected conflicts between signals

### Signal Extractors (5 total)
1. **SearchHistoryExtractor** (`search_history`)
   - Financial intent (stocks, crypto, trading)
   - Career intent (job search, interviews)
   - Education intent (degrees, courses)
   - Relocation intent (moving, apartments)
   - Health/fitness intent

2. **SocialBehaviorExtractor** (`social_media`, `reddit`, `twitter`)
   - Risk tolerance indicators (YOLO, diamond hands)
   - Anxiety/stress patterns
   - Decision paralysis detection
   - Social engagement level

3. **FinancialBehaviorExtractor** (`financial`, `plaid`, `banking`)
   - Impulse spending patterns
   - Budget adherence struggles
   - Active investment behavior

4. **CognitiveStructureExtractor** (`notes`, `obsidian`, `notion`)
   - Organization level (structured vs freeform)
   - Goal-setting behavior
   - Self-reflection depth

5. **MediaConsumptionExtractor** (`watch_history`, `youtube`, `netflix`)
   - Educational content bias
   - Entertainment vs education ratio
   - Binge consumption patterns

### Contradiction Detection
- **Stated vs Revealed**: Claims vs actual behavior (e.g., "patient" but urgent searches)
- **Temporal**: Changing patterns over time (e.g., goal-oriented but repeated failures)
- **Cross-Domain**: Different behaviors in different contexts (e.g., social risk vs financial conservatism)

### Composio SDK Integration
- Client wrapper for 250+ pre-built integrations
- Placeholder implementation (requires API key)
- Supports: Gmail, GitHub, LinkedIn, Slack, Notion, etc.

### Ingestion Workers
- Real signal extraction from uploaded files
- Automatic contradiction detection
- Signal storage in Neo4j graph
- Progress tracking and error handling

---

## ⏳ PLANNED: Phase 3 - Persona Engine (Weeks 8-10)

### GraphRAG Construction
- **DimensionMapper**: Map signals to behavioral dimensions
  - Risk tolerance (0-1 scale)
  - Time preference (immediate vs delayed gratification)
  - Social dependency (independent vs group-oriented)
  - Learning style (experiential vs theoretical)
  - Decision speed (deliberative vs impulsive)
  - Emotional volatility (stable vs reactive)

- **GraphBuilder**: Neo4j write operations
  - Trait nodes with confidence weights
  - Memory nodes (temporal events)
  - Relationship edges (influences, contradicts)
  - Vector embeddings for semantic search

### Master Persona Generation
- **PersonaCompressor**: Consolidate signals into coherent identity
  - Weight by recency (newer signals = higher weight)
  - Weight by evidence strength
  - Resolve contradictions (higher confidence wins)
  - Generate narrative summary

### Clone Generation
- **Stratified Sampling**: Generate 1,000 parameter-variant clones
  - Sample from probability distributions per dimension
  - Ensure coverage of edge cases (5th and 95th percentiles)
  - Maintain internal consistency

- **Clone Storage**: Neo4j Clone nodes linked to Persona
  - Each clone has unique parameter set
  - Ready for simulation execution

### Persona Versioning
- Every ingestion triggers optional persona rebuild
- Previous versions retained for 90 days
- Simulations record persona version for reproducibility

---

## ⏳ PLANNED: Phase 4 - Simulation Engine (Weeks 11-15)

### Decision Graphs
- **Scenario Schema**: Decision trees for each scenario type
  - Day Trading: Market events, panic triggers, learning curve
  - Startup: Funding rounds, pivots, founder burnout
  - Career Change: Skill transfer, income recovery, satisfaction

- **GraphBuilder**: Construct scenario-specific decision graphs
  - Decision nodes (user choice points)
  - Event nodes (world agent outputs)
  - Outcome nodes (terminal states)

### World Agents
- **Financial Agent**: Market returns, inflation, liquidity events
  - Historical return distributions (S&P 500, crypto, etc.)
  - Black swan event injection
  
- **Career Agent**: Job market conditions, salary growth, burnout risk
  - Industry-specific base rates
  - Skill transferability models

- **Education Agent**: Completion rates, ROI by degree type
  - Dropout probability by demographic
  - Salary premium post-degree

- **Social Agent**: Network effects, relationship decay
  - Relocation social cost models
  - Community integration timelines

### LLM Fork Evaluator
- **LLM Router**: Groq (fast/cheap) vs Anthropic (complex/expensive)
  - Fork complexity scoring (0-1)
  - Threshold-based routing (complexity > 0.6 = Anthropic)
  - Max 20 Anthropic calls per simulation

- **Fork Evaluation**: At each decision point
  - Input: Clone parameters + scenario state
  - Output: Probability distribution over choices
  - Context: Historical behavioral patterns

### Chaos Injection
- **Black Swan Events**: Low-probability, high-impact events
  - Medical emergencies
  - Market crashes
  - Relationship changes
  - Job loss

### Batch Orchestrator
- Execute 1,000 clones in parallel batches
- Real-time progress tracking
- Result aggregation

### Result Aggregator
- **Probability Distributions**: 
  - Outcome histograms (e.g., "Capital ruin: 35%, Break-even: 40%, Outsized return: 25%")
  - Timeline distributions (e.g., "Income recovery: mean 14 months, std 6 months")
  - Event probability (e.g., "Panic-sell trigger: 60%")

---

## ⏳ PLANNED: Phase 5 - CLI & API Polish (Weeks 16-17)

### CLI Interface
- `monte login` - Authenticate and store tokens
- `monte ingest --file` - Upload data
- `monte persona build` - Trigger persona rebuild
- `monte simulate --scenario day_trading` - Run simulation
- `monte results --sim-id XYZ` - Get probability distributions
- `monte stream --sim-id XYZ` - Real-time progress via SSE

### SSE Streaming
- Real-time simulation progress updates
- Clone completion counts
- Intermediate results

### OpenTelemetry
- Tracing for every pipeline step
- Metrics: simulation duration, LLM calls, queue depth
- Prometheus-compatible endpoints

### API Key System
- External agent access via API keys
- Rate limiting per key
- Usage analytics

---

## ⏳ PLANNED: Phase 6 - Extended Sources (Weeks 18+)

### Additional Composio Integrations
- **Gmail**: Extract decision patterns from sent emails
- **GitHub**: Code commit patterns (consistency, collaboration)
- **LinkedIn**: Career progression signals
- **Slack**: Communication style, response times

### Custom Signal Extractors
- Per-source extractors for new integrations
- No new OAuth/connector code needed (Composio handles it)

---

## File Structure

```
Monte/
├── src/
│   ├── api/
│   │   ├── plugins/         # Auth, rate limit, swagger
│   │   └── routes/          # All API endpoints
│   ├── config/              # Neo4j, Redis, MinIO, env
│   ├── ingestion/
│   │   ├── composio/        # SDK integration
│   │   ├── extractors/        # 5 signal extractors
│   │   ├── queue/             # BullMQ setup + workers
│   │   ├── types.ts           # Data type definitions
│   │   └── contradictionDetector.ts
│   ├── persona/             # (Phase 3) Graph builder, compressor
│   ├── simulation/          # (Phase 4) World agents, fork evaluator
│   └── utils/               # Logger, errors
├── tests/
├── docs/
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## Environment Variables Required

```bash
# Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Auth
JWT_SECRET=your_jwt_secret_min_32_chars
REFRESH_TOKEN_SECRET=your_refresh_secret_min_32_chars

# LLM (Phase 2+)
GROQ_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Integrations (Phase 2+)
COMPOSIO_API_KEY=

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

---

## Next Steps

1. **Phase 3**: Implement persona construction (dimension mapping, graph building, clone generation)
2. **Phase 4**: Build simulation engine (world agents, LLM fork evaluator, chaos injection)
3. **Phase 5**: Polish CLI/API (streaming, observability, agent API keys)
4. **Phase 6**: Add more Composio integrations

---

## Quality Targets (from PRD)

| Requirement | Target |
|-------------|--------|
| 1,000-clone simulation | < 90 seconds (p95) |
| Persona build time | < 5 minutes |
| API response (non-sim) | < 200ms (p95) |
| LLM calls per simulation | < 100 |
| Same-input variance | < 5% outcome shift |
| Neo4j query time | < 50ms |
| Concurrent simulations | >= 10 |
| Self-hosted cold start | < 2 minutes |
