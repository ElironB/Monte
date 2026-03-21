# Monte Persona Pipeline: Deep Technical Audit

## EXECUTIVE SUMMARY

The persona pipeline has solid infrastructure but critical architectural gaps preventing delivery on Monte's thesis: the contradiction IS the signal.

**Six fatal flaws:**
1. Contradictions detected but never consumed — zero influence on persona dimensions
2. Temporal context discarded before embedding — 3am anxiety search = 2pm curiosity search
3. Only 6 dimensions, missing executionGap (described as "the most predictive")
4. All sources weighted equally — Plaid ground truth = Reddit keyword match
5. No sequential pattern modeling — behavioral trajectories destroyed
6. Sparse data produces false confidence — no uncertainty communication

---

## 1. TEMPORAL SIGNAL ARCHITECTURE

### Current State

`temporalUtils.ts` does 4-bucket time-of-day classification and weekday/weekend. Recency decay in `dimensionMapper.ts` uses `exp(-days/60)` with floor 0.3.

**Critical bug**: `base.ts:17` sets `timestamp: new Date().toISOString()` — extraction time, not event time. Recency decay is broken for all batch-ingested data.

### Problems

| Issue | Severity |
|-------|----------|
| Temporal cluster metadata never used in dimension mapping | Critical |
| Fixed tau=60 days for all signal types | High |
| No cycle detection (weekly, monthly, seasonal) | High |
| No event sequencing | High |
| Extraction timestamp instead of event timestamp | Critical |

### Proposed Changes

**A. Fix timestamp propagation.** `createSignal()` must accept the original event timestamp. Each extractor already parses these.

**B. Temporal-aware embeddings.** Prepend temporal context before embedding:
```
"[late_night, weekend] searching 'am I making a mistake leaving my job'"
vs
"[afternoon, weekday] searching 'career change opportunities 2026'"
```
These produce meaningfully different vectors. Simplest change, highest impact.

**C. Adaptive recency decay by source type:**

| Source | Half-life (days) | Rationale |
|--------|-----------------|-----------|
| Plaid transactions | 180 | Spending habits are stable traits |
| Search history | 30 | Current anxieties, changes fast |
| Social media | 45 | Public persona evolves slower |
| Notes/documents | 120 | Cognitive patterns persist |
| Watch history | 21 | Entertainment preferences shift quickly |

**D. Cycle detection.** Autocorrelation at periods 7/14/30/90 days. When > 0.3, store `cyclePeriod` and `cyclePhase` on signals. Detects "every Friday night they impulsively shop."

**E. Behavioral epoch detection.** Changepoint detection on signal density to partition into behavioral epochs. Weight within-epoch signals higher.

---

## 2. CROSS-SOURCE CONTRADICTION SCORING

### The Fatal Flaw

`ContradictionDetector` finds contradictions, stores them in Neo4j, then `DimensionMapper` never reads them. The most predictive signals have zero influence on persona dimensions.

### Proposed Changes

**A. Quantitative contradiction magnitude (0-1):**
```
magnitude = abs(simA_high - simB_high) * sourceReliabilityGap * temporalOverlap
```

**B. Feed contradictions into DimensionMapper.** When contradictions exist on a dimension:
- Increase variance (widen confidence interval)
- For magnitude > 0.7: make the dimension bimodal in clone generation

**C. New contradiction types:**
- `anonymous_vs_public`: Compare behavior across anonymity levels (Reddit upvotes vs Twitter posts)
- `plan_vs_action`: Compare planning sources (Notion) against action sources (Plaid)

**D. Convergence tracking.** Track whether contradictions are resolving or deepening over time. Persistent contradictions (12+ months) are stable personality features.

**E. Contradiction structure:**
```typescript
interface SignalContradiction {
  id: string;
  signalAId: string;
  signalBId: string;
  type: 'stated_vs_revealed' | 'temporal' | 'cross_domain' | 'anonymous_vs_public' | 'plan_vs_action';
  magnitude: number;
  affectedDimensions: string[];
  firstSeen: string;
  lastSeen: string;
  convergenceRate: number; // -1 to 1
}
```

---

## 3. SEQUENTIAL PATTERN MODELING

### Current State

None. Each signal embedded independently. `coOccurrence` field populated but never used.

### Why It Matters

"how to start a business" then "LLC registration" then "business insurance" then "resignation letter template" is a NARRATIVE. Currently these are 4 unrelated signals.

### Proposed Changes

**A. Sliding window aggregation:**

| Window | Purpose |
|--------|---------|
| 24-hour | Emotional episodes (anxiety spirals, impulsive sprees) |
| 72-hour | Research sequences (deliberate investigation) |
| 7-day | Weekly behavioral patterns |
| 30-day | Commitment trajectories (sustained vs abandoned) |

**B. Sequence detection:** Sort signals by time. For K=5 nearest temporal neighbors, compute mean cosine similarity. When > 0.4 within 72h, flag as research cluster. Compute progression score (are signals getting more specific?).

**C. Embed sequences, not just signals.** Concatenate sequence members into composite signal with higher weight.

**D. Decision trajectory detection.** Map clusters to stages: Interest, Research, Comparison, Commitment, Action, Evaluation. A user who consistently reaches Comparison but never Commitment has a measurable execution pattern.

---

## 4. CONCEPT DESCRIPTION QUALITY

### Problems

1. Keyword-list format produces diffuse embeddings with low discriminability
2. Only 6 dimensions — missing executionGap, informationSeeking, stressResponse
3. Single anchor per pole — narrow capture radius
4. Construct contamination (riskTolerance mixes financial, physical, and social risk)

### Proposed Changes

**A. Expand to 9 dimensions:**

| Dimension | Measures |
|-----------|----------|
| riskTolerance | Financial risk-seeking vs aversion |
| timePreference | Immediate vs delayed gratification |
| socialDependency | Validation-seeking vs independent |
| learningStyle | Theoretical vs experiential |
| decisionSpeed | Impulsive vs deliberative |
| emotionalVolatility | Reactive vs stoic |
| **executionGap** | Plans without acting vs reliable follow-through |
| **informationSeeking** | Over-researches vs acts on minimal info |
| **stressResponse** | Panic/flight vs steady under pressure |

**B. Multiple anchors per pole (3-5 contextual sentences instead of keyword lists):**
```typescript
riskTolerance: {
  highAnchors: [
    "Puts significant savings into speculative investments like crypto and options",
    "Makes large financial commitments quickly without extensive due diligence",
    "Comfortable with possibility of losing invested money for higher returns",
    "Takes leveraged positions and concentrates in high-volatility assets",
  ],
  lowAnchors: [
    "Keeps most savings in low-risk vehicles like savings accounts and index funds",
    "Thoroughly researches every financial decision before committing",
    "Would rather miss a potential gain than risk losing existing capital",
    "Diversifies heavily, avoids any single position >5% of portfolio",
  ],
  negativeAnchors: [
    "Choosing between Thai and Italian food for dinner",
    "Preferring morning vs evening workouts",
  ],
}
```

**Scoring:** Mean similarity to top-2 anchors per pole. Negative anchors as relevance gate.

**C. Contextual sentences over keyword lists.** "Puts significant savings into speculative investments like crypto and options" embeds into a tighter, more specific region than "YOLO investing, gambling instinct, speculative trading."

---

## 5. SIGNAL WEIGHTING BY SOURCE RELIABILITY

### Proposed Hierarchy

| Tier | Source | Reliability | Rationale |
|------|--------|-------------|-----------|
| 1: Revealed Action | Plaid transactions | 0.95 | Ground truth of spending |
| 1: Revealed Action | GitHub commits | 0.90 | You did write the code |
| 2: Revealed Preference | YouTube completion | 0.80 | Attention = truth |
| 2: Revealed Preference | Reddit upvotes | 0.75 | Anonymous approval |
| 2: Revealed Preference | Search history | 0.75 | Unfiltered curiosity |
| 3: Semi-Curated | Reddit posts | 0.60 | Anonymous but performative |
| 3: Semi-Curated | Notes (Obsidian/Notion) | 0.55 | Aspirational self-image |
| 4: Curated Public | Twitter posts | 0.40 | Public performance |
| 4: Curated Public | LinkedIn | 0.35 | Professional theater |

### Implementation

Add `sourceReliability` and `anonymityLevel` to signal metadata. Multiply into dimension mapping:
```typescript
weightedSum += direction * strength * recency * relevance * sourceWeight;
```

Contradiction weight proportional to reliability gap between contradicting sources.

---

## 6. SPARSE DATA HANDLING

### Proposed Changes

**A. Per-dimension confidence with source diversity:**
```typescript
interface DimensionScore {
  value: number;
  confidence: number;
  signalCount: number;
  sourceCount: number;
  sourceTypes: string[];
  isEstimated: boolean;          // <3 signals or 1 source
  confidenceInterval: [number, number];
}
```

**B. CI calculation:**
```
CI_width = 0.4 / sqrt(signalCount) * (1/sourceCount) * estimation_penalty
```
Well-supported dimensions: CI +/-0.05. Sparse dimensions: CI +/-0.30.

**C. Clone generation respects uncertainty.** Variance = 0.30 for estimated dimensions, 0.15 * (1 - confidence) otherwise.

**D. Simulation engine uses confidence.** Low-confidence dimensions contribute less to fork evaluation. LLM prompt includes confidence context.

---

## 7. PERSONA DRIFT DETECTION

### Proposed Changes

**A. Sliding window comparison.** Compute dimensions from last-90-day signals vs full history. Flag dimensions where delta exceeds significance threshold.

**B. Update strategy selection:**

| Condition | Strategy |
|-----------|----------|
| No drift | Incremental Bayesian (current) |
| 1-2 dims drifting, <0.2 delta | Incremental with 60% blend |
| 3+ dims drifting, or any >0.3 delta | Full rebuild from last 12 months |
| 4+ dims, >0.4 delta | Full rebuild + user notification |

**C. Structured update history** (replace string concatenation):
```typescript
interface TraitUpdateEntry {
  timestamp: string;
  prior: number;
  posterior: number;
  signalCount: number;
  evidenceType: string;
}
```

---

## 8. THE EXECUTION GAP

### Current State

Does not exist as a dimension. PersonaCompressor has one hardcoded string: "Claims patience but acts impulsively - execution gap."

### Measurement Approach

**Plan signals** (from planning sources):
- Notion/Obsidian goals and resolutions (already extracted by cognitiveStructure)
- Versioned documents (budget_v7.md = 7 replans without completion)
- Calendar events created
- GitHub repos created

**Action signals** (from action sources):
- Plaid spending vs stated budget goals
- GitHub commit activity after repo creation (drop-off = abandoned)
- Calendar attendance vs creation ratio
- Search history progression past research phase

**Gap calculation per domain:**
- Document versioning: `min(1, version_count/5) * 0.3`
- GitHub abandonment: `abandoned_repos / total_repos`
- Calendar rescheduling: `rescheduled_3plus / total_events`
- Savings gap: `max(0, 1 - actual_savings/planned_savings)`

**Concept anchors:**
```typescript
executionGap: {
  highAnchors: [
    "Creates detailed plans and budgets but rarely follows through",
    "Has multiple abandoned projects spanning months",
    "Repeatedly revises deadlines without completing original commitment",
    "Sets ambitious goals in writing but behavior shows no progress",
  ],
  lowAnchors: [
    "Consistently follows through on stated plans and commitments",
    "Actual spending closely matches budgeted amounts over time",
    "Completes projects at a reliable rate after starting them",
    "Calendar commitments kept with minimal rescheduling",
  ],
}
```

---

## 9. BENCHMARK APPROACH

### A. Internal Consistency (split-half reliability)

Split signals 50/50 (stratified by source), build persona from each half, measure Pearson r between the two persona vectors. Target: r > 0.7.

Bootstrap: resample 100x, compute per-dimension std dev. Dimensions with std > 0.15 are unreliable.

### B. Cross-Source Coherence (leave-one-out)

Build persona with all sources vs each source removed. `source_leverage` = max dimensional shift per source. High leverage on a single source = sparse data concern.

### C. Discriminability

**Same-person stability**: Ingest same data twice. Dimensional delta should be < 0.05.

**Different-person divergence**: L2 distance between persona vectors. Distribution should clearly separate from intra-person distances. `discriminability_index` = (mean_inter - mean_intra) / pooled_std. Target: d' > 1.5.

**Simulation divergence**: Same scenario, different personas. KL divergence between outcome distributions. Target: D_KL > 0.2 for personas with L2 > 0.3.

### D. Per-Dimension Metrics

| Metric | Target |
|--------|--------|
| contradiction_capture_rate | >80% of planted contradictions detected |
| temporal_sensitivity | >0.05 dimension delta for same content at 3am vs 2pm |
| source_reliability_ordering | Plaid overrides Twitter for conflicting risk signals |
| execution_gap_accuracy | Gap detected when Notion goals contradict Plaid spending |
| drift_detection_latency | <10 signals to flag behavioral shift |
| sparse_data_humility | CI width >0.25 for single-source dimensions |

---

## IMPLEMENTATION PRIORITY

| Priority | Change | Effort |
|----------|--------|--------|
| P0 | Fix timestamp propagation in base extractor | Small |
| P0 | Feed contradictions into DimensionMapper | Medium |
| P1 | Add executionGap + informationSeeking + stressResponse dimensions | Large |
| P1 | Source reliability weighting | Medium |
| P1 | Multi-anchor concept descriptions | Medium |
| P1 | Per-dimension confidence intervals | Medium |
| P2 | Temporal-aware embeddings | Small |
| P2 | Adaptive recency decay | Small |
| P2 | Sequential pattern detection | Large |
| P2 | Contradiction magnitude + convergence | Medium |
| P3 | Cycle detection | Medium |
| P3 | Drift detection with strategy selection | Large |
| P3 | Benchmark suite | Large |
| P3 | Epoch detection | Large |
