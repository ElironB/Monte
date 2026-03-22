# Fix bogus 99.2% success rate + progress tracking
## Problem 1: Success rate is always ~99%
Two root causes:
### A. `categorizeOutcome()` in `decisionGraph.ts:1916`
The `default` case (used by `custom` scenario) returns `happiness > 0.5 ? 'success' : 'neutral'` — it **never returns 'failure'**. Since initial happiness is 0.7 and most clones stay above 0.5, everything is "success."
### B. `categorizeResult()` in `resultAggregator.ts:214`
* `capitalGood` check: `initialCapital > 0 ? capital > initialCapital * 0.8 : capital > 0`. Custom starts at $25k, so any clone ending above $20k is "good."
* `outcomeSuccess` list includes `'strategic_retreat'` and `'persistence_result'` — these aren't actually successes.
* The success condition is `outcomeSuccess || (happinessGood && capitalGood)` — the `||` means either alone is enough.
### Fix
1. `categorizeOutcome()`: Custom scenario needs real failure criteria — capital lost significantly, or happiness dropped, not just "above 0.5 = success"
2. `categorizeResult()`: Remove misleading outcomes from the success list (`strategic_retreat`, `persistence_result`). Make success require BOTH capital and happiness thresholds, not either/or. Use a sliding scale based on how much capital was preserved.
## Problem 2: Progress bar is useless
The CLI polls `progress-rest` every 2s, but progress only updates when an entire batch (100 clones) completes. Since 5 batches run in parallel and each takes ~3 min, there's a 3-minute gap of 0% followed by a jump to 50%.
### Fix
Publish per-clone progress within each batch. In `workers/index.ts processSimulation`, after each clone completes inside `Promise.all`, update Redis with a sub-batch progress count. The progress-rest endpoint already reads from Redis, so this flows through automatically.
Also: add a log line when each batch finishes so the server console shows something.