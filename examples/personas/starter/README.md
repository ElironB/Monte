# Starter Persona

This bundled persona is a product-minded software engineer with a stable job, disciplined saving habits, startup curiosity, and a recurring tendency to overthink big career and money decisions.

Use it to smoke-test Monte without generating synthetic data first.

Suggested flow:

```bash
monte example ingest starter
monte persona build
monte persona psychology
monte decide "should I leave my stable product job to join a startup and put $25k into the idea?" --mode fast --wait
```

Files included:

- `search-history.json`
- `reddit-posts.json`
- `transactions.csv`
- `watch-history.json`
- `notes/reflections.md`
