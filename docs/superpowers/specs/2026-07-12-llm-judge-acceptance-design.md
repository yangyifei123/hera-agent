# LLM-as-Judge Semantic Acceptance — Design

**Date:** 2026-07-12
**Status:** Approved (brainstorm complete; awaiting implementation plan)
**Big Bet:** #2 of 4 (see docs/internal/HERA_AUDIT_2026-06.md "Agent Self-Improvement & Evaluation")

## 1. Goals and non-goals

### Goals

1. **Semantic anti-perfunctory acceptance.** Upgrade the existing basic
   `llm_judge` check (single holistic rubric string, single score) to a
   production-grade analytic judge: multi-criterion rubric with per-criterion
   chain-of-thought scoring, so a task that "looks done" but is semantically
   empty fails with a locatable reason.
2. **Isolated judge.** Judging runs on a dedicated built-in `hera-judge`
   agent — minimal system prompt, zero tools, low temperature — not on the
   full Hera factory persona that may have delegated the work being judged.
3. **Evidence-based verdicts.** A check can declare file evidence; the
   evaluator reads it (bounded) and shows it to the judge, so file
   deliverables are judged by content, not by the worker's claims.
4. **Variance control.** Optional k-sample voting with deterministic
   aggregation for high-stakes checks; default stays 1 sample (no cost
   increase for everyday tasks).
5. **Auditable ledger.** Structured verdicts (per-criterion scores +
   reasoning) persist with the task in TaskStore and render readably in task
   tools.

### Non-goals

- No pairwise/comparative judging (single-candidate acceptance only).
- No eval scenario library or export/publish gate — that is Big Bet #3,
  which will reuse `RubricJudge`.
- No verdict-to-MemoryStore learning loop — deferred to Big Bet #4's design.
- No new dependencies.

## 2. Current state (verified in code)

- `src/engine/acceptance.ts` already has `llm_judge`
  (`{ type: "llm_judge"; rubric: string; threshold?: number }`, default
  threshold 0.7): strict single-shot prompt, 120s deadline, tolerant JSON
  parse (`parseJudgeReply`), fail-closed on no-judge/timeout/unparseable.
- The judge backend is `runner.run("hera", prompt)` wired in
  `src/engine/index.ts:92-97` — the full Hera agent with all tools.
- Verdict evidence is a flat `AcceptanceResult.detail` string.
- Known latent defect: exported withEngine plugins have no `"hera"` agent, so
  their `llm_judge` checks always fail with a runner error. This design fixes
  it via the configurable judge agent name (§6).

## 3. Schema evolution (`src/engine/task-types.ts`)

```ts
type RubricCriterion = {
  id?: string;            // stable handle; defaults to its index
  requirement: string;    // what must be true of the work
  weight?: number;        // default 1
  critical?: boolean;     // if true: its median score must independently
                          // meet the threshold or the check fails outright
};

type EvidenceSpec = {
  files: string[];        // resolved against ctx.cwd (same semantics as file_exists)
  maxBytesPerFile?: number;  // default JUDGE_EVIDENCE_FILE_CAP (64KB)
  maxTotalBytes?: number;    // default JUDGE_EVIDENCE_TOTAL_CAP (256KB)
};

// llm_judge becomes:
| {
    type: "llm_judge";
    rubric: string | RubricCriterion[];  // string → wrapped as one criterion
    threshold?: number;                  // default 0.7, applies to weighted total
    samples?: number;                    // default judge_samples_default (1), capped
    evidence?: EvidenceSpec;
  }
```

`AcceptanceResult` gains an optional structured verdict, persisted with the
task via the existing TaskStore result flow:

```ts
verdict?: {
  criteria: Array<{
    id: string;
    requirement: string;
    weight: number;
    critical: boolean;
    score: number;        // median across valid samples, clamped [0,1]
    reasoning: string;    // from the valid sample whose score for this
                          // criterion is closest to the median (ties → the
                          // earliest sample); the sole sample when k=1
  }>;
  overallScore: number;   // Σ(weight·score)/Σweight
  pass: boolean;
  samples: number;        // valid samples used
  aggregation: "single" | "median";
  judgeAgent: string;
  elapsedMs: number;
}
```

**Backward compatibility:** a string `rubric` is wrapped as
`[{ requirement: rubric, weight: 1 }]`; old persisted results without
`verdict` render as today (the `detail` string remains and is still written).

## 4. RubricJudge module (`src/engine/judge.ts`) — architecture A

A standalone unit; `AcceptanceEvaluator.llmJudge` becomes a one-line
delegation. Responsibilities, in pipeline order:

1. **`collectEvidence(spec, cwd)`** — bounded deterministic reads. Missing
   file → an evidence block labeled `MISSING` (absence is signal for the
   judge, not an evaluator error). Over-cap content → truncated with an
   explicit `[truncated at N bytes]` label. Caps come from constants
   (`JUDGE_EVIDENCE_FILE_CAP` 64KB, `JUDGE_EVIDENCE_TOTAL_CAP` 256KB),
   overridable per check, ceiling-clamped.
2. **`buildPrompt(criteria, output, evidence)`** — strict-judge persona with
   the bias-control set (§5); enumerates criteria; instructs
   reasoning-BEFORE-score per criterion; demands a single JSON object:
   `{"criteria":[{"id","score","reasoning"}]}` and nothing else.
3. **`sampleK(prompt, k)`** — k parallel `JudgeRunner` calls, each under the
   judge deadline; unparseable/failed samples are dropped; zero valid samples
   → fail-closed.
4. **`aggregate(criteria, sampleVerdicts, threshold)`** — per-criterion
   median score across valid samples; `overallScore` is the weighted mean of
   medians; **pass = overallScore ≥ threshold AND every `critical` criterion's
   median ≥ threshold**. Deterministic: no randomness in aggregation.

`parseVerdict()` extends the existing tolerant-JSON approach to the
per-criterion shape: extracts the outermost JSON object, validates each
criterion entry, clamps scores to [0,1], drops entries for unknown criterion
ids, and treats a sample missing any declared criterion as invalid.

## 5. Bias controls (all encoded in prompt/config, tested)

- **Strict default-fail** (kept from current prompt).
- **No authorship information** — the judge sees rubric, output, evidence;
  never which agent produced the work (self-enhancement bias).
- **CoT-before-score ordering** per criterion (leniency/variance reduction).
- **"Length is not quality"** explicit instruction (verbosity bias).
- **"Unevidenced claims are unproven"** — the judge must not credit the
  worker's success claims that evidence does not support.
- **Low temperature** — the `hera-judge` agent config sets 0.1.
- **Score clamping** to [0,1]; **fail-closed** on parse failure, timeout,
  missing judge, empty criteria array.

## 6. Built-in `hera-judge` agent + wiring

- `src/agents/judge.ts` — `createJudgeAgent(model)`: minimal judge-persona
  system prompt (JSON-only discipline), `mode: "subagent"`, temperature 0.1,
  **zero tools**: `permission` denies bash/edit/webfetch AND the `tools` map
  explicitly denies every `hera_*` tool including both dispatch meta-tools
  (the judge cannot even reach the catalog).
- Injected by the `config` hook like Hera itself — never written to disk,
  never in `registeredAgents`.
- Model: `hera.json` `judge_model`, falling back to `default_model` →
  session model.
- **Engine wiring:** `EngineOptions` gains `judgeAgent?: string`; the judge
  runner becomes `runner.run(opts.judgeAgent ?? "hera", prompt)` — the Hera
  plugin passes `"hera-judge"`. The plugin generators pass their own primary
  agent name so exported withEngine plugins get a working (if non-isolated)
  judge instead of today's guaranteed failure; generator docs note the
  limitation.
- **New `HeraConfig` fields** (+ runtime defaults in `src/index.ts`):
  `judge_model?`, `judge_samples_default?` (default 1, hard cap 5),
  `judge_timeout_ms?` (default 120000), `judge_evidence_max_bytes?`
  (default 262144).

## 7. Evaluator delegation and task-tool rendering

- `AcceptanceEvaluatorOptions` keeps `judge: JudgeRunner` unchanged and gains
  the judge options; the evaluator constructs one `RubricJudge` and
  `llmJudge()` delegates to it. The loop-manager path (`LoopManager` shares
  the evaluator) benefits with no changes.
- Task tools that render acceptance results (`hera_get_task` / task status
  rendering — exact site located during planning) show a per-criterion
  breakdown: `✓/✗ <requirement> — <score> — <one-line reasoning>`, so the
  failure cause is readable without spelunking JSON.

## 8. Error handling summary

| Condition | Behavior |
|---|---|
| No judge configured | fail, detail "no judge configured" (unchanged) |
| Evidence file missing/unreadable | evidence block labeled MISSING; judging continues |
| Evidence over caps | truncated with explicit label |
| Sample timeout / unparseable | sample dropped |
| Zero valid samples | fail-closed, detail names k and the failure kinds |
| Empty criteria array | fail-closed, "invalid llm_judge check: empty rubric" |
| Judge returns extra criteria / unknown ids | extras ignored; missing ids invalidate the sample |

## 9. Testing

- `src/engine/judge.test.ts` — prompt construction (criteria enumerated,
  CoT-before-score, no authorship, bias instructions present); evidence
  bounding (per-file + total caps, truncation labels, MISSING labels);
  aggregation math (median, weights, critical veto, threshold boundary
  cases); k-sampling (parallel, drops invalid, zero-valid fail-closed);
  parseVerdict robustness (markdown-fenced JSON, prose around JSON, clamping,
  missing-criterion invalidation).
- `src/engine/acceptance.test.ts` extensions — string-rubric wrapping;
  verdict attached to `AcceptanceResult`; fail-closed paths preserved.
- `src/agents/judge.test.ts` — `createJudgeAgent` denies all tools + both
  meta-tools, temperature 0.1, subagent mode.
- Executor/TaskStore round-trip — verdict survives persistence and reload.
- Generator test — exported withEngine plugin passes its own agent name as
  `judgeAgent`.

## 10. Decision log (brainstorm 2026-07-12)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Rubric shape | Analytic multi-criterion (weights, critical veto, CoT per criterion); string back-compat |
| 2 | Judge identity | Dedicated zero-tool `hera-judge` agent; model via `judge_model` |
| 3 | Evidence | Output + declared file evidence, bounded reads with labeled truncation/absence |
| 4 | Consistency | Default 1 sample; optional k-sample voting, per-criterion median |
| 5 | Persistence | Structured verdict into TaskStore ledger; task tools render breakdown |
| 6 | Architecture | A — standalone `src/engine/judge.ts` RubricJudge; acceptance.ts delegates |
