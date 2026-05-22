# 90-Day Growth Backlog

> Evidence-driven backlog prioritized by KPI impact. Updated after each weekly KPI review.

## Priority Framework

- **P0**: Blocks growth or damages trust
- **P1**: Directly moves 30-day KPI targets
- **P2**: Supports 60-day KPI targets
- **P3**: Supports 90-day KPI targets or exploratory

---

## P0 — Blockers (Do Immediately)

| ID | Item | Impact Hypothesis | Effort | Owner | Status |
|----|------|-------------------|--------|-------|--------|
| B1 | Fix subagent mode confusion | Prevents activation drop-off (users create subagent then can't use it) | Small | Maintainer | Done (README clarifies mode) |
| B2 | Verify install path on fresh machine | Blocks activation if install fails on clean env | Small | Maintainer | Pending |
| B3 | Add `hera doctor` to README Quick Start | Reduces activation friction (doctor confirms install works) | Small | Maintainer | Done |

## P1 — 30-Day Growth (Week 1-4)

| ID | Item | Impact Hypothesis | Effort | Owner | KPI Target |
|----|------|-------------------|--------|-------|------------|
| G1 | Submit Show HN post | Direct awareness: HN drives 200-500 visits on launch | Small | Maintainer | Stars +200 |
| G2 | Submit to awesome-opencode | Direct awareness: OpenCode users discover Hera | Small | Maintainer | Stars +50 |
| G3 | Post in r/LocalLLaMA | Direct awareness: local-first community values offline capability | Small | Maintainer | Stars +30 |
| G4 | X/Twitter thread launch | Direct awareness: developer community on X | Small | Maintainer | Stars +20 |
| G5 | Add demo GIF/screenshot to README | Reduces activation friction: visual proof beats text | Medium | Maintainer | Installs +20% |
| G6 | Add GitHub Discussions tab | Trust signal: shows project is alive and responsive | Small | Maintainer | Trust ratio +5% |

## P2 — 60-Day Growth (Week 5-8)

| ID | Item | Impact Hypothesis | Effort | Owner | KPI Target |
|----|------|-------------------|--------|-------|------------|
| H1 | Submit to awesome-ai-agents | Awareness: broader AI agent community | Small | Maintainer | Stars +50 |
| H2 | Write Dev.to tutorial: "How I Built an Agent Factory" | Awareness + trust: long-form content drives inbound | Medium | Maintainer | Stars +30, Installs +15% |
| H3 | Add interactive `hera demo` command | Activation: one-command demo reduces time-to-value | Medium | Maintainer | Installs +25% |
| H4 | Issue template auto-response (stale bot) | Trust: shows responsiveness even on low-priority issues | Small | Maintainer | Response time <48h |
| H5 | Submit to awesome-bun | Awareness: Bun ecosystem users | Small | Maintainer | Stars +20 |
| H6 | Contribute Hera example to OpenCode docs | Awareness + trust: official docs mention | Medium | Maintainer | Stars +40 |

## P3 — 90-Day Growth (Week 9-12)

| ID | Item | Impact Hypothesis | Effort | Owner | KPI Target |
|----|------|-------------------|--------|-------|------------|
| J1 | Add agent marketplace concept design | Trust + activation: ecosystem play | Large | Maintainer | Exploratory |
| J2 | Create video walkthrough | Awareness: YouTube/dev video drives inbound | Medium | Maintainer | Stars +50 |
| J3 | Add telemetry opt-in (anonymous) | Data: understand activation funnel | Medium | Maintainer | Data-driven |
| J4 | Publish comparison page: Hera vs CrewAI vs AutoGen | Trust + awareness: SEO-driven decision page | Medium | Maintainer | Stars +30 |
| J5 | Hackathon participation / sponsorship | Awareness: developer event visibility | Large | Maintainer | Stars +20 |
| J6 | i18n for README (CN, JP) | Awareness: non-English developer markets | Medium | Maintainer | Stars +50 |

---

## Evidence Log

| Date | Finding | Action Taken | KPI Impact |
|------|---------|--------------|------------|
| 2026-05-22 | README was 754 lines with duplicate content | Rewrote to 328-line conversion flow | Activation ↑ |
| 2026-05-22 | No canonical demo existed | Created 7-step 2-minute demo | Activation ↑ |
| 2026-05-22 | No CODE_OF_CONDUCT.md | Added Contributor Covenant 1.4 | Trust ↑ |
| 2026-05-22 | CHANGELOG missing v2.2.0 entry | Added v2.2.0 changelog | Maintenance ↑ |
| 2026-05-22 | Internal reports cluttering root/ | Moved 10 files to docs/internal/ | Trust ↑ |

## Alignment Check

Every P0/P1 item maps to a KPI category:
- B1, B2, B3 → Activation (preventing drop-off)
- G1-G4 → Awareness (stars, visitors)
- G5 → Activation (installs)
- G6 → Trust (responsiveness)
- H1-H6 → Awareness + Trust (inbound, responsiveness, docs)
- J1-J6 → Awareness + Trust (ecosystem, SEO, events)