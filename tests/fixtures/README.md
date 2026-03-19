# Sample Test Data

These files are synthetic test data designed to exercise every signal extractor in Monte Engine.
They are NOT real personal data — they're crafted to trigger specific behavioral signals.

## Usage

```bash
monte ingest tests/fixtures
```

## What Each File Tests

| File | Extractor | Signals Triggered |
|------|-----------|-------------------|
| search-history.json | SearchHistoryExtractor | financial_trading, career_change, education, relocation, health_fitness |
| reddit-posts.json | SocialBehaviorExtractor | high_risk_tolerance, anxiety, decision_paralysis |
| transactions.csv | FinancialBehaviorExtractor | impulse_spending, budget_struggles, active_investor |
| notes/goals-2026.md | CognitiveStructureExtractor | highly_organized, goal_oriented, deep_self_reflection |
| watch-history.json | MediaConsumptionExtractor | educational_content, learning_focused, high_media_consumption |

## Expected Contradictions

The data is designed to trigger contradiction detection:
- **Cross-domain**: high_risk_tolerance (from reddit) + impulse_spending/budget_struggles (from transactions)
- **Temporal**: goal_oriented (from notes) + budget_struggles (from transactions) 
