# Benchmark Snapshot

This directory stores a committed machine-readable benchmark summary so npm users and contributors can inspect the current regression baseline without running the full harness first.

Current snapshot:

- file: `latest-benchmark.json`
- fixture version: `phase3-v2`
- generated from: `npm run benchmark -- --output examples/benchmarks/latest-benchmark.json`

Headline metrics from the current snapshot:

- fixtures: `3`
- pass rate: `100%`
- calibration MAE: `0.000`
- static policy regret: `0.2324`
- uncertainty reduction: `0.0801`
- max stability drift: `0.000`
