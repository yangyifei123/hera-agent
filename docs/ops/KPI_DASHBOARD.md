# 30/60/90 KPI Dashboard

> Hera's growth operating loop. Track awareness, activation, trust, and maintenance metrics weekly.

## Metric Categories

### 1. Awareness (Are people finding Hera?)

| Metric | Baseline | 30-Day Target | 60-Day Target | 90-Day Target | Owner | Cadence |
|--------|----------|---------------|---------------|---------------|-------|---------|
| GitHub stars | Current | +200 | +500 | +1000 | Maintainer | Weekly |
| Unique GitHub repo visitors/week | 0 | 500 | 1500 | 3000 | Maintainer | Weekly |
| npm weekly downloads | Current | 100 | 300 | 500 | Maintainer | Weekly |
| HN post upvotes (if launched) | 0 | 50 | — | — | Maintainer | One-time |
| Reddit post upvotes (if launched) | 0 | 30 | — | — | Maintainer | One-time |

**Data source**: GitHub Insights, npmjs.com stats

### 2. Activation (Are people trying it?)

| Metric | Baseline | 30-Day Target | 60-Day Target | 90-Day Target | Owner | Cadence |
|--------|----------|---------------|---------------|---------------|-------|---------|
| `bun add hera-agent` completions/week | 0 | 30 | 80 | 150 | Maintainer | Weekly |
| `hera doctor` runs/week (if telemetry) | 0 | 20 | 60 | 100 | Maintainer | Weekly |
| Agent creations (first agent created) | 0 | 15 | 40 | 80 | Maintainer | Weekly |
| GitHub Issues opened (questions, not bugs) | 0 | 5 | 10 | 15 | Maintainer | Weekly |

**Data source**: npm download stats (public), GitHub Issues tracking

### 3. Trust (Do people trust it enough to use it seriously?)

| Metric | Baseline | 30-Day Target | 60-Day Target | 90-Day Target | Owner | Cadence |
|--------|----------|---------------|---------------|---------------|-------|---------|
| GitHub Issues response time (median) | — | <48h | <24h | <12h | Maintainer | Weekly |
| PRs from external contributors | 0 | 1 | 3 | 5 | Maintainer | Monthly |
| Stars-to-issues ratio | — | >10:1 | >15:1 | >20:1 | Maintainer | Monthly |
| Awesome list inclusions | 0 | 1 | 2 | 3 | Maintainer | Monthly |

**Data source**: GitHub Insights, manual tracking

### 4. Maintenance (Is the project healthy?)

| Metric | Baseline | 30-Day Target | 60-Day Target | 90-Day Target | Owner | Cadence |
|--------|----------|---------------|---------------|---------------|-------|---------|
| Open issues (untriaged) | Current | <5 | <3 | <2 | Maintainer | Weekly |
| Release frequency | — | 1 patch/2weeks | 1 minor/month | 1 minor/month | Maintainer | Monthly |
| Test pass rate | 100% | 100% | 100% | 100% | Maintainer | Per-PR |
| Lint/typecheck pass rate | 100% | 100% | 100% | 100% | Maintainer | Per-PR |

**Data source**: CI/CD, GitHub Actions

## Weekly Review Template

```markdown
## Hera KPI Review — Week of [DATE]

### Awareness
- Stars: [current] (Δ [change])
- Visitors: [current]/week
- Downloads: [current]/week

### Activation
- Installs: [current]/week
- First agents created: [current]/week
- Issues opened: [current]/week

### Trust
- Median issue response: [hours]h
- External PRs: [current]
- Awesome list inclusions: [current]

### Maintenance
- Open untriaged issues: [current]
- Last release: [date]
- CI status: [pass/fail]

### Top 3 Insights
1. [Insight]
2. [Insight]
3. [Insight]

### Actions for Next Week
1. [Action]
2. [Action]
3. [Action]
```

## Review Cadence

- **Weekly**: Maintainer reviews KPI dashboard, fills template
- **Monthly**: Cross-reference KPI deltas to adjust growth tactics
- **Quarterly**: Full retro against 30/60/90 targets, update roadmap