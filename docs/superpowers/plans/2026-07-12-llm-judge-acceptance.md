# LLM-as-Judge Semantic Acceptance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Hera's `llm_judge` acceptance check to a production-grade analytic judge: multi-criterion rubric with per-criterion CoT scoring, dedicated zero-tool `hera-judge` agent, bounded file evidence, optional k-sample median voting, and structured verdicts persisted in the task ledger.

**Architecture:** New standalone `src/engine/judge.ts` (RubricJudge: evidence → prompt → k samples → median aggregate); `AcceptanceEvaluator.llmJudge` becomes a delegation. A built-in `hera-judge` agent (zero tools, temperature 0.1) is injected by the config hook; `EngineOptions.judgeAgent` makes the judge backend agent configurable (fixes exported withEngine plugins whose judge was hardcoded to the nonexistent `"hera"`).

**Tech Stack:** TypeScript (Bun), zod (existing), bun:test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-llm-judge-acceptance-design.md` — §2 current state, §4 pipeline, §5 bias controls, §6 wiring are binding.

## Global Constraints

- NEVER touch the real OpenCode config root `C:\Users\Administrator\.config\opencode`; runtime experiments use `HERA_CONFIG_ROOT` pointed at a temp dir.
- `heraLog()` not `console.*`; constants in `src/constants.ts`; bun:test colocated with source; English code and Conventional Commits.
- Release gate stays green: `bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run`.
- Backward compatibility is load-bearing: a string `rubric` must keep working (wrapped as one criterion); existing acceptance tests may only be extended, and their behavioral assertions (fail-closed paths, detail containing the score like "0.90", "no judge", "unparseable") must still pass.
- Fail-closed everywhere: no judge / zero valid samples / empty criteria → `passed: false` with an actionable `detail`.
- The judge never gets tools: permission denies edit/bash/webfetch AND the agent `tools` map denies every `hera_*` tool including `hera_find_tools`/`hera_run_tool`.

## Verified code anchors (2026-07-12, master @ 7884796)

- `src/engine/acceptance.ts` — current `llmJudge` at 197-238, `parseJudgeReply` at 274-290, `withDeadline` at 240-255, `JudgeRunner` type at 65, options at 67-72.
- `src/engine/task-types.ts` — `AcceptanceCheck` union at 4-11, `AcceptanceResult` at 13-18, `TaskRecord.proof` field.
- `src/engine/index.ts` — evaluator wiring at 92-97 (`judge: opts.client ? (prompt) => runner.run("hera", prompt) : undefined`).
- `src/engine/executor.ts:77` — `evaluate(task.acceptance, { output, cwd: this.cwd }, now)`; proof persists via `commitTerminal` → `store.updateFromDisk` (verdicts ride along automatically once on `AcceptanceResult`).
- `src/engine/opencode-agent-runner.ts:12` — `run(executor: string, prompt: string, signal?: AbortSignal): Promise<string>`; agent name goes to `body.agent`.
- `src/tools/acceptance-schema.ts:27-31` — llm_judge zod variant; `validateWatchCondition` rejects llm_judge (keep).
- `src/tools/task-tools.ts:129-143` — `hera_task_status` renders `Proof: ${JSON.stringify(task.proof)}`; enqueue acceptance description at 73-77 omits llm_judge.
- `src/agents/hera.ts:170` `createHeraAgent` return shape at 229-238; `AgentConfig` from `@opencode-ai/sdk`.
- `src/index.ts:190-196` — `createEngine({ dataDir, cwd, client, config, teamManager, singleton })`; hera injection in config hook (search `configInput.agent["hera"]`).
- Generators' engine bootstrap: `plugin-generator.ts:348`, `team-plugin-generator.ts:266`.
- `src/engine/acceptance.test.ts` — judge mocked as inline `async () => '<json>'` lambda; `evalr.evaluate([check], { output, cwd: dir }, 1)` pattern.

---

### Task 1: Types + zod schema (`task-types.ts`, `acceptance-schema.ts`)

**Files:**
- Modify: `src/engine/task-types.ts` (union at lines 4-11, `AcceptanceResult` at 13-18)
- Modify: `src/tools/acceptance-schema.ts` (llm_judge variant at 27-31)
- Test: `src/tools/acceptance-schema.test.ts` (extend if it exists — check; otherwise create)

**Interfaces (produced — later tasks import these exact names from `../engine/task-types.js` / `./task-types.js`):**

```ts
export interface RubricCriterion {
  id?: string;
  requirement: string;
  weight?: number;      // default 1 (applied at normalization, not here)
  critical?: boolean;   // median must independently meet threshold
}

export interface EvidenceSpec {
  files: string[];
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export interface CriterionVerdict {
  id: string;
  requirement: string;
  weight: number;
  critical: boolean;
  score: number;      // median across valid samples, clamped [0,1]
  reasoning: string;
}

export interface JudgeVerdictRecord {
  criteria: CriterionVerdict[];
  overallScore: number;
  pass: boolean;
  samples: number;
  aggregation: "single" | "median";
  judgeAgent: string;
  elapsedMs: number;
}
```

The `llm_judge` union member becomes:

```ts
| {
    type: "llm_judge";
    rubric: string | RubricCriterion[];
    threshold?: number;
    samples?: number;
    evidence?: EvidenceSpec;
  };
```

`AcceptanceResult` gains `verdict?: JudgeVerdictRecord;` between `detail` and `at`.

- [ ] **Step 1: Write the failing schema test** (in `src/tools/acceptance-schema.test.ts`; follow the file's existing style if present, else create with the bun:test header used across the repo):

```ts
import { describe, expect, it } from "bun:test";
import { validateAcceptanceChecks } from "./acceptance-schema.js";

describe("llm_judge schema (analytic)", () => {
  it("accepts a plain string rubric (back-compat)", () => {
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "does it work" }]).valid
    ).toBe(true);
  });

  it("accepts an analytic rubric with weights/critical/samples/evidence", () => {
    const res = validateAcceptanceChecks([
      {
        type: "llm_judge",
        rubric: [
          { requirement: "README documents the new flag", weight: 2 },
          { id: "tests", requirement: "tests cover the failure path", critical: true },
        ],
        threshold: 0.8,
        samples: 3,
        evidence: { files: ["README.md"], maxBytesPerFile: 1024 },
      },
    ]);
    expect(res.valid).toBe(true);
  });

  it("rejects an empty criteria array", () => {
    expect(validateAcceptanceChecks([{ type: "llm_judge", rubric: [] }]).valid).toBe(false);
  });

  it("rejects samples above the cap and non-[0,1] thresholds", () => {
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "x", samples: 6 }]).valid
    ).toBe(false);
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "x", threshold: 1.5 }]).valid
    ).toBe(false);
  });

  it("rejects evidence with an empty files array", () => {
    expect(
      validateAcceptanceChecks([
        { type: "llm_judge", rubric: "x", evidence: { files: [] } },
      ]).valid
    ).toBe(false);
  });
});
```

(Adapt import/validator name to the actual export — the Explore report confirms `validateAcceptanceChecks` in `src/tools/acceptance-schema.ts:39-55` returning a `{ valid }`-shaped result; read the file first and match its exact return type in assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/tools/acceptance-schema.test.ts`
Expected: FAIL (analytic rubric array rejected by current schema).

- [ ] **Step 3: Implement types + schema**

`src/engine/task-types.ts`: add the four interfaces above (before `AcceptanceCheck`), replace the llm_judge union member, add `verdict?: JudgeVerdictRecord;` to `AcceptanceResult`. Keep the existing comment, updating "rubric (0-1)" wording to mention analytic criteria.

`src/tools/acceptance-schema.ts`: replace the llm_judge variant with:

```ts
const rubricCriterionSchema = z.object({
  id: z.string().min(1).optional(),
  requirement: z.string().min(1),
  weight: z.number().positive().optional(),
  critical: z.boolean().optional(),
});

// inside the discriminated union:
z.object({
  type: z.literal("llm_judge"),
  rubric: z.union([z.string().min(1), z.array(rubricCriterionSchema).min(1)]),
  threshold: z.number().min(0).max(1).optional(),
  samples: z.number().int().min(1).max(5).optional(),
  evidence: z
    .object({
      files: z.array(z.string().min(1)).min(1),
      maxBytesPerFile: z.number().int().positive().optional(),
      maxTotalBytes: z.number().int().positive().optional(),
    })
    .optional(),
}),
```

- [ ] **Step 4: Run tests**

Run: `bun test src/tools/acceptance-schema.test.ts src/engine/ src/tools/task-tools.test.ts && bun run typecheck`
Expected: PASS (types are additive; nothing else compiled against the old union shape narrowly enough to break — if typecheck flags a site, fix it minimally and note it).

- [ ] **Step 5: Commit**

```bash
git add src/engine/task-types.ts src/tools/acceptance-schema.ts src/tools/acceptance-schema.test.ts
git commit -m "feat(engine): analytic rubric types + llm_judge schema (criteria/samples/evidence)"
```

---

### Task 2: RubricJudge (`src/engine/judge.ts`) + constants

**Files:**
- Create: `src/engine/judge.ts`
- Modify: `src/constants.ts` (append judge constants)
- Test: `src/engine/judge.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces (exact exports later tasks rely on):
  - `export type JudgeRunner = (prompt: string) => Promise<string>;` — MOVED here from acceptance.ts (Task 3 re-exports from acceptance.ts for back-compat).
  - `export interface NormalizedCriterion { id: string; requirement: string; weight: number; critical: boolean }`
  - `export function normalizeCriteria(rubric: string | RubricCriterion[]): NormalizedCriterion[]`
  - `export async function collectEvidence(spec: EvidenceSpec | undefined, cwd: string, caps: { fileCap: number; totalCap: number }): Promise<string>`
  - `export function buildJudgePrompt(criteria: NormalizedCriterion[], output: string, evidence: string): string`
  - `export function parseAnalyticVerdict(reply: string, expectedIds: string[]): Map<string, { score: number; reasoning: string }> | null`
  - `export function aggregate(criteria: NormalizedCriterion[], samples: Array<Map<string, { score: number; reasoning: string }>>, threshold: number, meta: { judgeAgent: string; elapsedMs: number }): JudgeVerdictRecord`
  - `export interface RubricJudgeOptions { timeoutMs?: number; defaultSamples?: number; maxSamples?: number; evidenceFileCap?: number; evidenceTotalCap?: number; judgeAgentName?: string }`
  - `export class RubricJudge { constructor(runner: JudgeRunner, options?: RubricJudgeOptions); judge(check: Extract<AcceptanceCheck, { type: "llm_judge" }>, ctx: { output: string; cwd: string }): Promise<{ passed: boolean; detail: string; verdict?: JudgeVerdictRecord }> }`
- Constants appended to `src/constants.ts`:

```ts
// === LLM-as-judge acceptance ===

/** Default weighted-total threshold for llm_judge checks. */
export const JUDGE_DEFAULT_THRESHOLD = 0.7;
/** Per-evidence-file read cap (chars ≈ bytes for utf-8 source text). */
export const JUDGE_EVIDENCE_FILE_CAP = 65536;
/** Total evidence budget per check. */
export const JUDGE_EVIDENCE_TOTAL_CAP = 262144;
/** Hard cap on k-sample voting. */
export const JUDGE_MAX_SAMPLES = 5;
/** Default judge call deadline. */
export const JUDGE_TIMEOUT_MS = 120000;
/** Max agent steps for the built-in judge agent (text-only, no tool loops). */
export const JUDGE_MAX_STEPS = 3;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/judge.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RubricJudge,
  aggregate,
  buildJudgePrompt,
  collectEvidence,
  normalizeCriteria,
  parseAnalyticVerdict,
} from "./judge.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "judge-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const CRITERIA = normalizeCriteria([
  { requirement: "code compiles", weight: 1 },
  { id: "docs", requirement: "docs updated", weight: 2, critical: true },
]);

function sample(scores: Record<string, number>): Map<string, { score: number; reasoning: string }> {
  return new Map(Object.entries(scores).map(([id, score]) => [id, { score, reasoning: `r-${id}-${score}` }]));
}

describe("normalizeCriteria", () => {
  it("wraps a string rubric as one criterion", () => {
    expect(normalizeCriteria("just work")).toEqual([
      { id: "c1", requirement: "just work", weight: 1, critical: false },
    ]);
  });
  it("assigns index ids, default weight 1, and drops empty requirements", () => {
    const out = normalizeCriteria([
      { requirement: "a" },
      { requirement: "  " },
      { id: "x", requirement: "b", weight: 3, critical: true },
    ]);
    expect(out).toEqual([
      { id: "c1", requirement: "a", weight: 1, critical: false },
      { id: "x", requirement: "b", weight: 3, critical: true },
    ]);
  });
  it("returns [] for an empty/blank rubric", () => {
    expect(normalizeCriteria("   ")).toEqual([]);
    expect(normalizeCriteria([])).toEqual([]);
  });
});

describe("collectEvidence", () => {
  it("reads declared files with labels", async () => {
    await writeFile(join(dir, "a.txt"), "hello evidence");
    const text = await collectEvidence({ files: ["a.txt"] }, dir, { fileCap: 1000, totalCap: 2000 });
    expect(text).toContain("--- EVIDENCE a.txt ---");
    expect(text).toContain("hello evidence");
  });
  it("labels missing files MISSING and keeps going", async () => {
    await writeFile(join(dir, "b.txt"), "real");
    const text = await collectEvidence({ files: ["nope.txt", "b.txt"] }, dir, { fileCap: 1000, totalCap: 2000 });
    expect(text).toContain("MISSING");
    expect(text).toContain("real");
  });
  it("truncates per-file with an explicit label", async () => {
    await writeFile(join(dir, "big.txt"), "x".repeat(500));
    const text = await collectEvidence(
      { files: ["big.txt"], maxBytesPerFile: 100 },
      dir,
      { fileCap: 1000, totalCap: 2000 }
    );
    expect(text).toContain("[truncated at 100 bytes]");
    expect(text.split("x").length - 1).toBeLessThanOrEqual(101);
  });
  it("enforces the total budget across files", async () => {
    await writeFile(join(dir, "one.txt"), "a".repeat(150));
    await writeFile(join(dir, "two.txt"), "b".repeat(150));
    const text = await collectEvidence({ files: ["one.txt", "two.txt"] }, dir, {
      fileCap: 1000,
      totalCap: 200,
    });
    expect(text).toContain("[truncated at 50 bytes]"); // second file gets the remainder
  });
  it("returns empty string when no spec", async () => {
    expect(await collectEvidence(undefined, dir, { fileCap: 1, totalCap: 1 })).toBe("");
  });
});

describe("buildJudgePrompt", () => {
  const prompt = buildJudgePrompt(CRITERIA, "the output", "--- EVIDENCE a ---\nstuff");
  it("enumerates criteria with ids and demands reasoning before score", () => {
    expect(prompt).toContain("[c1]");
    expect(prompt).toContain("[docs]");
    const reasoningIdx = prompt.indexOf('"reasoning"');
    const scoreIdx = prompt.indexOf('"score"');
    expect(reasoningIdx).toBeGreaterThan(-1);
    expect(reasoningIdx).toBeLessThan(scoreIdx);
  });
  it("contains the bias-control instructions and no authorship info", () => {
    expect(prompt.toLowerCase()).toContain("length");        // length-is-not-quality
    expect(prompt.toLowerCase()).toContain("unproven");      // unevidenced claims
    expect(prompt).not.toContain("hera");                     // no authorship/agent identity
  });
  it("includes output and evidence blocks", () => {
    expect(prompt).toContain("the output");
    expect(prompt).toContain("--- EVIDENCE a ---");
  });
});

describe("parseAnalyticVerdict", () => {
  const ids = ["c1", "docs"];
  it("parses a clean verdict", () => {
    const v = parseAnalyticVerdict(
      '{"criteria":[{"id":"c1","reasoning":"ok","score":0.9},{"id":"docs","reasoning":"good","score":1}]}',
      ids
    );
    expect(v?.get("c1")).toEqual({ score: 0.9, reasoning: "ok" });
  });
  it("tolerates prose and markdown fences around the JSON", () => {
    const v = parseAnalyticVerdict(
      'Sure!\n```json\n{"criteria":[{"id":"c1","reasoning":"r","score":0.5},{"id":"docs","reasoning":"r","score":0.5}]}\n```\nDone.',
      ids
    );
    expect(v?.get("docs")?.score).toBe(0.5);
  });
  it("clamps scores to [0,1] and ignores unknown ids", () => {
    const v = parseAnalyticVerdict(
      '{"criteria":[{"id":"c1","reasoning":"r","score":7},{"id":"docs","reasoning":"r","score":-1},{"id":"ghost","reasoning":"r","score":1}]}',
      ids
    );
    expect(v?.get("c1")?.score).toBe(1);
    expect(v?.get("docs")?.score).toBe(0);
    expect(v?.has("ghost")).toBe(false);
  });
  it("returns null when a declared criterion is missing or JSON is absent", () => {
    expect(
      parseAnalyticVerdict('{"criteria":[{"id":"c1","reasoning":"r","score":1}]}', ids)
    ).toBeNull();
    expect(parseAnalyticVerdict("no json here", ids)).toBeNull();
  });
});

describe("aggregate", () => {
  const meta = { judgeAgent: "hera-judge", elapsedMs: 5 };
  it("weighted mean of per-criterion medians; odd k takes middle", () => {
    const v = aggregate(
      CRITERIA,
      [sample({ c1: 0.2, docs: 1 }), sample({ c1: 0.8, docs: 0.9 }), sample({ c1: 0.5, docs: 0.8 })],
      0.7,
      meta
    );
    expect(v.criteria.find((c) => c.id === "c1")?.score).toBe(0.5);
    expect(v.criteria.find((c) => c.id === "docs")?.score).toBe(0.9);
    expect(v.overallScore).toBeCloseTo((0.5 * 1 + 0.9 * 2) / 3, 5);
    expect(v.aggregation).toBe("median");
    expect(v.pass).toBe(true);
  });
  it("even k averages the middle two", () => {
    const v = aggregate(CRITERIA, [sample({ c1: 0.4, docs: 1 }), sample({ c1: 0.6, docs: 1 })], 0.7, meta);
    expect(v.criteria.find((c) => c.id === "c1")?.score).toBeCloseTo(0.5, 5);
  });
  it("critical criterion below threshold vetoes even a passing total", () => {
    const v = aggregate(CRITERIA, [sample({ c1: 1, docs: 0.6 })], 0.7, meta);
    expect(v.overallScore).toBeCloseTo((1 + 0.6 * 2) / 3, 5); // ≈0.733 ≥ 0.7
    expect(v.pass).toBe(false); // docs is critical and 0.6 < 0.7
  });
  it("reasoning comes from the sample closest to the median (earliest tie-break)", () => {
    const v = aggregate(
      CRITERIA,
      [sample({ c1: 0.2, docs: 1 }), sample({ c1: 0.5, docs: 1 }), sample({ c1: 0.8, docs: 1 })],
      0.7,
      meta
    );
    expect(v.criteria.find((c) => c.id === "c1")?.reasoning).toBe("r-c1-0.5");
  });
  it("single sample reports aggregation 'single'", () => {
    expect(aggregate(CRITERIA, [sample({ c1: 1, docs: 1 })], 0.7, meta).aggregation).toBe("single");
  });
});

describe("RubricJudge.judge", () => {
  const goodReply = (c1: number, docs: number) =>
    `{"criteria":[{"id":"c1","reasoning":"a","score":${c1}},{"id":"docs","reasoning":"b","score":${docs}}]}`;
  const CHECK = {
    type: "llm_judge" as const,
    rubric: [
      { requirement: "code compiles" },
      { id: "docs", requirement: "docs updated", weight: 2, critical: true },
    ],
    threshold: 0.7,
  };

  it("happy path: passes and returns a verdict", async () => {
    const j = new RubricJudge(async () => goodReply(0.9, 0.95), { judgeAgentName: "hera-judge" });
    const r = await j.judge(CHECK, { output: "done", cwd: dir });
    expect(r.passed).toBe(true);
    expect(r.verdict?.judgeAgent).toBe("hera-judge");
    expect(r.detail).toContain("0.9");
  });

  it("k samples run and aggregate by median", async () => {
    let n = 0;
    const replies = [goodReply(0.2, 1), goodReply(0.8, 1), goodReply(0.6, 1)];
    const j = new RubricJudge(async () => replies[n++ % 3], {});
    const r = await j.judge({ ...CHECK, samples: 3 }, { output: "x", cwd: dir });
    expect(r.verdict?.samples).toBe(3);
    expect(r.verdict?.criteria.find((c) => c.id === "c1")?.score).toBe(0.6);
  });

  it("drops invalid samples; zero valid fails closed with 'unparseable' in detail", async () => {
    const j = new RubricJudge(async () => "I feel it is fine.", {});
    const r = await j.judge(CHECK, { output: "x", cwd: dir });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("unparseable");
    expect(r.verdict).toBeUndefined();
  });

  it("empty rubric fails closed without calling the runner", async () => {
    let called = 0;
    const j = new RubricJudge(async () => {
      called++;
      return "{}";
    }, {});
    const r = await j.judge({ type: "llm_judge", rubric: "   " }, { output: "x", cwd: dir });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("empty rubric");
    expect(called).toBe(0);
  });

  it("samples cap: requests above maxSamples are clamped", async () => {
    let calls = 0;
    const j = new RubricJudge(
      async () => {
        calls++;
        return goodReply(1, 1);
      },
      { maxSamples: 2 }
    );
    await j.judge({ ...CHECK, samples: 50 }, { output: "x", cwd: dir });
    expect(calls).toBe(2);
  });

  it("evidence lands in the prompt", async () => {
    await writeFile(join(dir, "proof.md"), "EVIDENT-CONTENT");
    let seen = "";
    const j = new RubricJudge(async (p) => {
      seen = p;
      return goodReply(1, 1);
    }, {});
    await j.judge({ ...CHECK, evidence: { files: ["proof.md"] } }, { output: "x", cwd: dir });
    expect(seen).toContain("EVIDENT-CONTENT");
  });

  it("runner timeout fails closed (deadline)", async () => {
    const j = new RubricJudge(() => new Promise(() => {}), { timeoutMs: 30 });
    const r = await j.judge(CHECK, { output: "x", cwd: dir });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("no valid verdicts");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/judge.test.ts`
Expected: FAIL — module `./judge.js` not found.

- [ ] **Step 3: Implement `src/engine/judge.ts`** (append the constants block from Interfaces to `src/constants.ts` first):

```ts
// src/engine/judge.ts
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  JUDGE_DEFAULT_THRESHOLD,
  JUDGE_EVIDENCE_FILE_CAP,
  JUDGE_EVIDENCE_TOTAL_CAP,
  JUDGE_MAX_SAMPLES,
  JUDGE_TIMEOUT_MS,
} from "../constants.js";
import type {
  AcceptanceCheck,
  CriterionVerdict,
  EvidenceSpec,
  JudgeVerdictRecord,
  RubricCriterion,
} from "./task-types.js";

/** Calls an LLM to judge work output; returns the model's raw text reply. */
export type JudgeRunner = (prompt: string) => Promise<string>;

export interface NormalizedCriterion {
  id: string;
  requirement: string;
  weight: number;
  critical: boolean;
}

type LlmJudgeCheck = Extract<AcceptanceCheck, { type: "llm_judge" }>;
type SampleScores = Map<string, { score: number; reasoning: string }>;

export function normalizeCriteria(rubric: string | RubricCriterion[]): NormalizedCriterion[] {
  if (typeof rubric === "string") {
    const requirement = rubric.trim();
    return requirement ? [{ id: "c1", requirement, weight: 1, critical: false }] : [];
  }
  return rubric
    .filter((c) => typeof c.requirement === "string" && c.requirement.trim().length > 0)
    .map((c, i) => ({
      id: c.id?.trim() || `c${i + 1}`,
      requirement: c.requirement.trim(),
      weight: typeof c.weight === "number" && c.weight > 0 ? c.weight : 1,
      critical: c.critical === true,
    }));
}

/**
 * Bounded, deterministic evidence reads. A missing file is labeled MISSING —
 * absence is signal for the judge, not an evaluator error (spec §8). Caps are
 * approximate bytes (JS string length; utf-8 multi-byte drift is acceptable
 * for a budget mechanism).
 */
export async function collectEvidence(
  spec: EvidenceSpec | undefined,
  cwd: string,
  caps: { fileCap: number; totalCap: number }
): Promise<string> {
  if (!spec || spec.files.length === 0) return "";
  const perFileCap = boundedCap(spec.maxBytesPerFile, caps.fileCap);
  const totalCap = boundedCap(spec.maxTotalBytes, caps.totalCap);
  let used = 0;
  const blocks: string[] = [];
  for (const file of spec.files) {
    const path = isAbsolute(file) ? file : join(cwd, file);
    let body: string;
    try {
      const content = await readFile(path, "utf-8");
      const budget = Math.min(perFileCap, totalCap - used);
      if (budget <= 0) {
        body = "[omitted: total evidence budget exhausted]";
      } else if (content.length > budget) {
        body = `${content.slice(0, budget)}\n[truncated at ${budget} bytes]`;
        used += budget;
      } else {
        body = content;
        used += content.length;
      }
    } catch {
      body = "MISSING (file not found or unreadable)";
    }
    blocks.push(`--- EVIDENCE ${file} ---\n${body}`);
  }
  return blocks.join("\n\n");
}

/** User-supplied caps may only tighten, never exceed, the configured ceiling. */
function boundedCap(requested: number | undefined, ceiling: number): number {
  if (typeof requested === "number" && requested > 0) return Math.min(requested, ceiling);
  return ceiling;
}

/**
 * Strict analytic-judge prompt with the spec §5 bias-control set. Deliberately
 * contains no authorship/agent information about who produced the work.
 */
export function buildJudgePrompt(
  criteria: NormalizedCriterion[],
  output: string,
  evidence: string
): string {
  const criteriaLines = criteria
    .map((c) => `[${c.id}] ${c.requirement}${c.critical ? " (CRITICAL)" : ""}`)
    .join("\n");
  return [
    "You are a STRICT acceptance judge. Score the work below against each",
    "criterion independently. Be skeptical: default to low scores unless the",
    "material clearly and verifiably meets the criterion.",
    "",
    "Rules:",
    "- Judge only what is in front of you. Claims of success that the output or",
    "  evidence does not substantiate are unproven and must not raise scores.",
    "- Length is not quality. Do not reward verbosity.",
    "- For EACH criterion, write your reasoning FIRST, then assign the score",
    "  (a number from 0 to 1).",
    "",
    `CRITERIA:\n${criteriaLines}`,
    "",
    `WORK OUTPUT:\n${output || "(empty)"}`,
    ...(evidence ? ["", `EVIDENCE:\n${evidence}`] : []),
    "",
    "Respond with ONLY this JSON object and nothing else:",
    '{"criteria":[{"id":"<criterion id>","reasoning":"<why>","score":<0..1>}, ...]}',
    "Include every criterion id exactly once.",
  ].join("\n");
}

/**
 * Tolerantly extract the per-criterion verdict. A sample is valid only if it
 * covers every expected criterion id; unknown ids are ignored; scores clamp
 * to [0,1].
 */
export function parseAnalyticVerdict(reply: string, expectedIds: string[]): SampleScores | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const criteria = (parsed as { criteria?: unknown }).criteria;
  if (!Array.isArray(criteria)) return null;
  const out: SampleScores = new Map();
  const expected = new Set(expectedIds);
  for (const entry of criteria) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    if (!expected.has(id)) continue;
    const raw = typeof e.score === "number" ? e.score : NaN;
    if (Number.isNaN(raw)) continue;
    out.set(id, {
      score: Math.max(0, Math.min(1, raw)),
      reasoning: typeof e.reasoning === "string" ? e.reasoning : "",
    });
  }
  for (const id of expectedIds) {
    if (!out.has(id)) return null;
  }
  return out;
}

/** Deterministic aggregation: per-criterion median, weighted total, critical veto. */
export function aggregate(
  criteria: NormalizedCriterion[],
  samples: SampleScores[],
  threshold: number,
  meta: { judgeAgent: string; elapsedMs: number }
): JudgeVerdictRecord {
  const criteriaVerdicts: CriterionVerdict[] = criteria.map((c) => {
    const scores = samples.map((s) => s.get(c.id)!.score).sort((a, b) => a - b);
    const mid = scores.length / 2;
    const median =
      scores.length % 2 === 1 ? scores[(scores.length - 1) / 2] : (scores[mid - 1] + scores[mid]) / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    samples.forEach((s, i) => {
      const d = Math.abs(s.get(c.id)!.score - median);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    return {
      id: c.id,
      requirement: c.requirement,
      weight: c.weight,
      critical: c.critical,
      score: median,
      reasoning: samples[bestIdx].get(c.id)!.reasoning,
    };
  });
  const totalWeight = criteriaVerdicts.reduce((sum, c) => sum + c.weight, 0);
  const overallScore =
    criteriaVerdicts.reduce((sum, c) => sum + c.weight * c.score, 0) / totalWeight;
  const criticalOk = criteriaVerdicts.every((c) => !c.critical || c.score >= threshold);
  return {
    criteria: criteriaVerdicts,
    overallScore,
    pass: overallScore >= threshold && criticalOk,
    samples: samples.length,
    aggregation: samples.length > 1 ? "median" : "single",
    judgeAgent: meta.judgeAgent,
    elapsedMs: meta.elapsedMs,
  };
}

export interface RubricJudgeOptions {
  timeoutMs?: number;
  defaultSamples?: number;
  maxSamples?: number;
  evidenceFileCap?: number;
  evidenceTotalCap?: number;
  judgeAgentName?: string;
}

export class RubricJudge {
  constructor(
    private runner: JudgeRunner,
    private options: RubricJudgeOptions = {}
  ) {}

  async judge(
    check: LlmJudgeCheck,
    ctx: { output: string; cwd: string }
  ): Promise<{ passed: boolean; detail: string; verdict?: JudgeVerdictRecord }> {
    const started = Date.now();
    const criteria = normalizeCriteria(check.rubric);
    if (criteria.length === 0) {
      return { passed: false, detail: "invalid llm_judge check: empty rubric" };
    }
    const threshold = check.threshold ?? JUDGE_DEFAULT_THRESHOLD;
    const maxSamples = this.options.maxSamples ?? JUDGE_MAX_SAMPLES;
    const k = Math.min(Math.max(check.samples ?? this.options.defaultSamples ?? 1, 1), maxSamples);
    const evidence = await collectEvidence(check.evidence, ctx.cwd, {
      fileCap: this.options.evidenceFileCap ?? JUDGE_EVIDENCE_FILE_CAP,
      totalCap: this.options.evidenceTotalCap ?? JUDGE_EVIDENCE_TOTAL_CAP,
    });
    const prompt = buildJudgePrompt(criteria, ctx.output, evidence);
    const expectedIds = criteria.map((c) => c.id);

    const settled = await Promise.all(
      Array.from({ length: k }, () => this.sampleOne(prompt, expectedIds))
    );
    const valid = settled.filter((s): s is SampleScores => s !== null);
    if (valid.length === 0) {
      return {
        passed: false,
        detail: `judge returned no valid verdicts (${k} sample(s) unparseable, errored, or timed out)`,
      };
    }

    const verdict = aggregate(criteria, valid, threshold, {
      judgeAgent: this.options.judgeAgentName ?? "unknown",
      elapsedMs: Date.now() - started,
    });
    const failing = verdict.criteria.filter(
      (c) => c.score < threshold && (c.critical || verdict.overallScore < threshold)
    );
    const failText =
      failing.length > 0
        ? ` failing: ${failing.map((c) => `${c.id} ${c.score.toFixed(2)}`).join(", ")}`
        : "";
    return {
      passed: verdict.pass,
      detail:
        `judge ${verdict.overallScore.toFixed(2)} (threshold ${threshold}, ` +
        `${verdict.samples} sample(s)): ${verdict.pass ? "pass" : "fail"}.${failText}`,
      verdict,
    };
  }

  private async sampleOne(prompt: string, expectedIds: string[]): Promise<SampleScores | null> {
    try {
      const reply = await this.withDeadline(
        this.runner(prompt),
        this.options.timeoutMs ?? JUDGE_TIMEOUT_MS
      );
      return parseAnalyticVerdict(reply, expectedIds);
    } catch {
      return null;
    }
  }

  private withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    if (!ms || ms <= 0) return p;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`judge timed out after ${ms}ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/engine/judge.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/engine/judge.ts src/engine/judge.test.ts src/constants.ts
git commit -m "feat(engine): RubricJudge — analytic rubric, bounded evidence, k-sample median"
```

---

### Task 3: AcceptanceEvaluator delegates (`acceptance.ts`)

**Files:**
- Modify: `src/engine/acceptance.ts` (llmJudge 197-238, parseJudgeReply 267-290, withDeadline 240-255, JudgeRunner 64-65, options 67-84)
- Test: extend `src/engine/acceptance.test.ts`

**Interfaces:**
- Consumes: `RubricJudge`, `JudgeRunner` from `./judge.js` (Task 2).
- Produces: `AcceptanceEvaluatorOptions` gains `judgeAgentName?: string; judgeDefaultSamples?: number; judgeEvidenceFileCap?: number; judgeEvidenceTotalCap?: number` (existing `judge`/`judgeTimeoutMs` keep their names). `export type { JudgeRunner } from "./judge.js";` re-export preserves the old import path for any consumer.

- [ ] **Step 1: Extend the failing tests** (add to `src/engine/acceptance.test.ts`):

```ts
it("llm_judge: analytic rubric produces a structured verdict on the result", async () => {
  const evalr2 = new AcceptanceEvaluator({
    judge: async () =>
      '{"criteria":[{"id":"c1","reasoning":"solid","score":0.9}]}',
    judgeAgentName: "hera-judge",
  });
  const r = await evalr2.evaluate(
    [{ type: "llm_judge", rubric: "is it good" }],
    { output: "work", cwd: dir },
    1
  );
  expect(r[0].passed).toBe(true);
  expect(r[0].verdict?.criteria[0].score).toBe(0.9);
  expect(r[0].verdict?.judgeAgent).toBe("hera-judge");
  expect(r[0].detail).toContain("0.90");
});

it("llm_judge: multi-criterion critical veto fails the check", async () => {
  const evalr2 = new AcceptanceEvaluator({
    judge: async () =>
      '{"criteria":[{"id":"c1","reasoning":"r","score":1},{"id":"docs","reasoning":"r","score":0.5}]}',
  });
  const r = await evalr2.evaluate(
    [
      {
        type: "llm_judge",
        rubric: [
          { requirement: "works" },
          { id: "docs", requirement: "documented", critical: true },
        ],
      },
    ],
    { output: "work", cwd: dir },
    1
  );
  expect(r[0].passed).toBe(false);
  expect(r[0].verdict?.pass).toBe(false);
});
```

Also add the spec §9 persistence round-trip check (verdict is plain data; this pins that nothing non-serializable sneaks in later):

```ts
it("verdict survives JSON persistence round-trip", async () => {
  const evalr2 = new AcceptanceEvaluator({
    judge: async () => '{"criteria":[{"id":"c1","reasoning":"r","score":0.8}]}',
  });
  const r = await evalr2.evaluate(
    [{ type: "llm_judge", rubric: "good" }],
    { output: "w", cwd: dir },
    1
  );
  expect(JSON.parse(JSON.stringify(r[0]))).toEqual(r[0]);
});
```

The four EXISTING llm_judge tests (passing case asserting detail contains "0.90"; below-threshold; "no judge"; "unparseable") must pass unchanged EXCEPT: the old single-verdict JSON format `'{"pass": true, "score": 0.9, ...}'` is no longer what the judge asks for — those two tests' mock replies must be updated to the analytic shape (`'{"criteria":[{"id":"c1","reasoning":"...","score":0.9}]}'`). Their assertions (passed/threshold/detail-contains) stay identical. Do NOT weaken any assertion.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/acceptance.test.ts`
Expected: FAIL (`verdict` undefined; new options unknown).

- [ ] **Step 3: Implement the delegation** in `src/engine/acceptance.ts`:

1. Replace the local `JudgeRunner` definition with `import { RubricJudge, type JudgeRunner } from "./judge.js";` and add `export type { JudgeRunner } from "./judge.js";`.
2. Extend the options interface:

```ts
export interface AcceptanceEvaluatorOptions {
  shellEnabled?: boolean;
  defaultTimeoutMs?: number;
  judge?: JudgeRunner;
  judgeTimeoutMs?: number;
  judgeAgentName?: string;
  judgeDefaultSamples?: number;
  judgeEvidenceFileCap?: number;
  judgeEvidenceTotalCap?: number;
}
```

3. In the constructor, build the judge once:

```ts
this.rubricJudge = options.judge
  ? new RubricJudge(options.judge, {
      timeoutMs: options.judgeTimeoutMs ?? 120000,
      defaultSamples: options.judgeDefaultSamples,
      evidenceFileCap: options.judgeEvidenceFileCap,
      evidenceTotalCap: options.judgeEvidenceTotalCap,
      judgeAgentName: options.judgeAgentName ?? "unknown",
    })
  : undefined;
```

(private field `rubricJudge: RubricJudge | undefined`; the old `judge`/`judgeTimeoutMs` fields go away.)

4. Replace the whole `llmJudge` method body with:

```ts
private async llmJudge(
  check: Extract<AcceptanceCheck, { type: "llm_judge" }>,
  ctx: AcceptanceContext,
  now: number
): Promise<AcceptanceResult> {
  if (!this.rubricJudge) return this.result(check, false, now, "no judge configured");
  const { passed, detail, verdict } = await this.rubricJudge.judge(check, {
    output: ctx.output,
    cwd: ctx.cwd,
  });
  const res = this.result(check, passed, now, detail);
  if (verdict) res.verdict = verdict;
  return res;
}
```

5. Delete the now-dead `parseJudgeReply`, `JudgeVerdict` interface, and `withDeadline` (judge.ts owns deadlines). Keep `boundedRegexTest` etc. untouched.

- [ ] **Step 4: Run tests**

Run: `bun test src/engine/acceptance.test.ts src/engine/judge.test.ts && bun run typecheck`
Expected: PASS. If `heraLog` or other imports go unused after the deletion, remove them (lint will flag).

- [ ] **Step 5: Commit**

```bash
git add src/engine/acceptance.ts src/engine/acceptance.test.ts
git commit -m "feat(engine): acceptance llm_judge delegates to RubricJudge (verdict on result)"
```

---

### Task 4: Engine + config wiring (`engine/index.ts`, `types.ts`)

**Files:**
- Modify: `src/engine/index.ts` (EngineOptions; evaluator wiring at 92-97)
- Modify: `src/types.ts` (HeraConfig at 302-328)

**Interfaces:**
- Produces: `EngineOptions.judgeAgent?: string` (default behavior unchanged: `"hera"`); `HeraConfig` gains `judge_model?: string; judge_samples_default?: number; judge_timeout_ms?: number; judge_evidence_max_bytes?: number;`. The engine's `config` option (structural type on `EngineOptions` — read it first) gains the same four optional fields.

- [ ] **Step 1: Implement (no new test file — behavior covered by Task 3 tests + Task 5 injection test; typecheck is the guard here)**

`src/types.ts` — append to `HeraConfig` (after `loop_max_consecutive_failures`):

```ts
/** Model for the built-in hera-judge agent (default: default_model → session model). */
judge_model?: string;
/** Default k for llm_judge sampling when a check omits `samples` (default 1, hard cap 5). */
judge_samples_default?: number;
/** Judge call deadline in ms (default 120000). */
judge_timeout_ms?: number;
/** Total evidence budget per llm_judge check in bytes (default 262144). */
judge_evidence_max_bytes?: number;
```

`src/engine/index.ts`:
1. Add `judgeAgent?: string;` to `EngineOptions` with a doc comment: "Agent name the llm_judge backend runs on (default \"hera\"). The Hera plugin passes \"hera-judge\"; generated plugins pass their own agent."
2. Extend the `EngineOptions` config structural type with the four `judge_*` fields (mirror how `task_lease_ms` etc. are declared there).
3. Replace the evaluator construction (92-97) with:

```ts
const judgeAgentName = opts.judgeAgent ?? "hera";
const evaluator = new AcceptanceEvaluator({
  shellEnabled: getDefaultPermission()?.bash !== "deny",
  defaultTimeoutMs: c.task_lease_ms ?? TASK_LEASE_MS,
  // Reuse the agent runner as the llm_judge backend when a client is present.
  judge: opts.client ? (prompt) => runner.run(judgeAgentName, prompt) : undefined,
  judgeTimeoutMs: c.judge_timeout_ms ?? JUDGE_TIMEOUT_MS,
  judgeAgentName,
  judgeDefaultSamples: c.judge_samples_default,
  judgeEvidenceTotalCap: c.judge_evidence_max_bytes,
});
```

Import `JUDGE_TIMEOUT_MS` from `../constants.js` (merge into the existing constants import).

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun test src/engine/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/index.ts src/types.ts
git commit -m "feat(engine): configurable judge agent + judge_* config plumbing"
```

---

### Task 5: Built-in hera-judge agent + injection (`src/agents/judge.ts`, `src/index.ts`)

**Files:**
- Create: `src/agents/judge.ts`
- Modify: `src/index.ts` (config hook hera injection block — search `configInput.agent["hera"]`; createEngine call at 190-196)
- Test: `src/agents/judge.test.ts`

**Interfaces:**
- Produces: `export const JUDGE_AGENT_NAME = "hera-judge";` and `export function createJudgeAgent(model: string, heraToolNames: string[]): AgentConfig`.
- Consumes: `JUDGE_MAX_STEPS` from constants (Task 2); `heraToolNames` module-scope value in `src/index.ts` (exists since Big Bet #1, Task 7 there).

- [ ] **Step 1: Write the failing test**

```ts
// src/agents/judge.test.ts
import { describe, expect, it } from "bun:test";
import { JUDGE_AGENT_NAME, createJudgeAgent } from "./judge.js";

describe("createJudgeAgent", () => {
  const cfg = createJudgeAgent("test-model", ["hera_create_agent", "hera_remember"]);

  it("is a zero-tool subagent", () => {
    expect(cfg.mode).toBe("subagent");
    expect(cfg.tools?.["hera_create_agent"]).toBe(false);
    expect(cfg.tools?.["hera_remember"]).toBe(false);
    expect(cfg.tools?.["hera_find_tools"]).toBe(false);
    expect(cfg.tools?.["hera_run_tool"]).toBe(false);
    expect(cfg.permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
  });

  it("runs cold and shallow", () => {
    expect(cfg.temperature).toBe(0.1);
    expect(cfg.model).toBe("test-model");
    expect((cfg.maxSteps ?? 99) <= 3).toBe(true);
  });

  it("prompt is judge-only: no factory persona, JSON discipline", () => {
    expect(cfg.prompt).toContain("judge");
    expect(cfg.prompt).toContain("JSON");
    expect(cfg.prompt?.toLowerCase()).toContain("no tools");
    expect(cfg.prompt).not.toContain("Agent Factory");
  });

  it("exports the canonical name", () => {
    expect(JUDGE_AGENT_NAME).toBe("hera-judge");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/agents/judge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agents/judge.ts`**

```ts
// src/agents/judge.ts
import type { AgentConfig } from "@opencode-ai/sdk";
import { JUDGE_MAX_STEPS } from "../constants.js";

/** Canonical name of the built-in acceptance judge agent. */
export const JUDGE_AGENT_NAME = "hera-judge";

const JUDGE_PROMPT = [
  "You are a strict, impartial acceptance judge.",
  "",
  "You receive a rubric, work output, and optionally evidence. Your only job",
  "is to score the work against each rubric criterion.",
  "",
  "Rules:",
  "- You have NO tools. Judge solely from the material in the prompt.",
  "- Be skeptical. Unsubstantiated claims of success are unproven.",
  "- Length is not quality.",
  "- Reason first, then score.",
  "- Respond with ONLY the JSON object the prompt requests — no prose, no",
  "  markdown fences, nothing else.",
].join("\n");

/**
 * Built-in zero-tool judge agent (spec §6). Injected by the config hook like
 * Hera itself — never persisted to disk, never in registeredAgents. Denies
 * every hera_* tool INCLUDING the dispatch meta-tools, and all shell/edit/web
 * permissions: the judge cannot act, only read its prompt and answer.
 */
export function createJudgeAgent(model: string, heraToolNames: string[]): AgentConfig {
  const tools: Record<string, boolean> = {
    hera_find_tools: false,
    hera_run_tool: false,
  };
  for (const name of heraToolNames) tools[name] = false;
  return {
    description: "Hera's built-in acceptance judge — zero tools, low temperature.",
    mode: "subagent",
    prompt: JUDGE_PROMPT,
    model,
    temperature: 0.1,
    maxSteps: JUDGE_MAX_STEPS,
    permission: { edit: "deny", bash: "deny", webfetch: "deny" },
    tools,
  };
}
```

- [ ] **Step 4: Wire injection + engine option in `src/index.ts`**

1. Import: `import { JUDGE_AGENT_NAME, createJudgeAgent } from "./agents/judge.js";`
2. In the `createEngine({...})` call (lines 190-196), add `judgeAgent: JUDGE_AGENT_NAME,`.
3. In the config hook, immediately after the `configInput.agent["hera"] = heraCfg;` line, add:

```ts
// Built-in acceptance judge: zero tools, low temperature, judge-only persona.
// Injected like Hera itself (not persisted, not in registeredAgents).
configInput.agent[JUDGE_AGENT_NAME] = createJudgeAgent(
  config.judge_model ?? model,
  heraToolNames
);
```

(`heraToolNames` already exists at module scope from Big Bet #1. Note: the engine is created BEFORE the hooks object, and the config hook runs on session start — the injection is available before any task executes a judge call.)

- [ ] **Step 5: Run tests**

Run: `bun test src/agents/ && bun run typecheck && bun run lint:fix`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/agents/judge.ts src/agents/judge.test.ts src/index.ts
git commit -m "feat(agents): built-in zero-tool hera-judge agent wired as engine judge backend"
```

---

### Task 6: Verdict rendering in task tools (`task-tools.ts`)

**Files:**
- Modify: `src/tools/task-tools.ts` (`hera_task_status` at 129-143; enqueue acceptance description at 73-77)
- Test: extend `src/tools/task-tools.test.ts` (exists — read its fixture style first)

**Interfaces:**
- Consumes: `AcceptanceResult.verdict` (Task 1), `JUDGE_DEFAULT_THRESHOLD` (Task 2).
- Produces: exported `formatProof(proof: AcceptanceResult[]): string` (exported for tests).

- [ ] **Step 1: Write the failing test** (adapt to the file's existing mock-ctx pattern):

```ts
import { formatProof } from "./task-tools.js";

describe("formatProof", () => {
  it("renders per-criterion verdict lines with pass/fail marks", () => {
    const out = formatProof([
      {
        check: { type: "llm_judge", rubric: "r", threshold: 0.7 },
        passed: false,
        detail: "judge 0.55 (threshold 0.7, 1 sample(s)): fail.",
        at: 1,
        verdict: {
          criteria: [
            { id: "c1", requirement: "works", weight: 1, critical: false, score: 0.9, reasoning: "compiles and runs" },
            { id: "docs", requirement: "documented", weight: 2, critical: true, score: 0.4, reasoning: "README unchanged" },
          ],
          overallScore: 0.55,
          pass: false,
          samples: 1,
          aggregation: "single",
          judgeAgent: "hera-judge",
          elapsedMs: 42,
        },
      },
    ]);
    expect(out).toContain("✗ [llm_judge]");
    expect(out).toContain("✓ works — 0.90");
    expect(out).toContain("✗ documented — 0.40 (critical)");
    expect(out).toContain("README unchanged");
  });

  it("renders non-judge checks as one line each", () => {
    const out = formatProof([
      { check: { type: "file_exists", path: "a" }, passed: true, detail: "exists", at: 1 },
    ]);
    expect(out).toContain("✓ [file_exists] exists");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/tools/task-tools.test.ts`
Expected: FAIL — `formatProof` not exported.

- [ ] **Step 3: Implement**

Add to `task-tools.ts` (module scope, above the factory):

```ts
import { JUDGE_DEFAULT_THRESHOLD } from "../constants.js";
import type { AcceptanceResult } from "../engine/task-types.js";

/** Human-readable proof rendering; per-criterion breakdown for llm_judge verdicts. */
export function formatProof(proof: AcceptanceResult[]): string {
  return proof
    .map((r) => {
      const head = `${r.passed ? "✓" : "✗"} [${r.check.type}] ${r.detail ?? ""}`.trimEnd();
      if (!r.verdict) return head;
      const threshold =
        r.check.type === "llm_judge" ? (r.check.threshold ?? JUDGE_DEFAULT_THRESHOLD) : JUDGE_DEFAULT_THRESHOLD;
      const lines = r.verdict.criteria.map((c) => {
        const mark = c.score >= threshold ? "✓" : "✗";
        const crit = c.critical ? " (critical)" : "";
        const reason = c.reasoning.split("\n")[0];
        return `  ${mark} ${c.requirement} — ${c.score.toFixed(2)}${crit} — ${reason}`;
      });
      return [head, ...lines].join("\n");
    })
    .join("\n");
}
```

In `hera_task_status` (line 138), replace `` task.proof ? `Proof: ${JSON.stringify(task.proof)}` : "" `` with:

```ts
task.proof ? `Proof:\n${formatProof(task.proof)}` : "",
```

Update the enqueue `acceptance` description (73-77) to name all four check types:

```ts
.describe(
  "Acceptance checks (shell/file_exists/regex/llm_judge); ALL must pass. Required, non-empty. " +
    "llm_judge supports an analytic rubric: [{requirement, weight?, critical?}] plus samples and evidence files."
),
```

- [ ] **Step 4: Run tests**

Run: `bun test src/tools/task-tools.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/task-tools.ts src/tools/task-tools.test.ts
git commit -m "feat(tools): per-criterion verdict rendering in task status"
```

---

### Task 7: Generator judgeAgent pass-through

**Files:**
- Modify: `src/generators/plugin-generator.ts` (engine bootstrap at ~348)
- Modify: `src/generators/team-plugin-generator.ts` (engine bootstrap at ~266)
- Test: extend `src/generators/plugin-generator.test.ts` (engine injection describe) and `src/generators/team-plugin-generator.test.ts`

**Interfaces:** none new — emitted code changes only.

- [ ] **Step 1: Write the failing tests**

```ts
// plugin-generator.test.ts, in the engine-injection describe:
it("passes the agent name as the engine judgeAgent", () => {
  const code = generator.generatePluginIndex(makeTestAgent(), [], true, true);
  expect(code).toContain('judgeAgent: "test-agent"');
});

// team-plugin-generator.test.ts:
it("passes the first member as the engine judgeAgent", () => {
  const code = gen.generatePluginIndex(makeTeam(), [makeAgent("alpha"), makeAgent("beta")], [], true, true);
  expect(code).toContain('judgeAgent: "alpha"');
});
```

(Adapt fixture helper names/arg order to each test file's existing style — read the neighboring engine-injection tests first.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/generators/plugin-generator.test.ts src/generators/team-plugin-generator.test.ts`
Expected: FAIL on the two new assertions.

- [ ] **Step 3: Implement**

`plugin-generator.ts` engine bootstrap template (line ~348): add the option, using JSON.stringify for safe embedding:

```ts
? `  const engine = createEngine({ dataDir: getHeraDataDir(), cwd: getHeraDataDir(), client: input.client, singleton: true, judgeAgent: ${JSON.stringify(agent.name)} });
```

`team-plugin-generator.ts` (line ~266): same, with the first member's agent name. Add a one-line comment ABOVE the emitted `const engine =` line inside the template string: `  // llm_judge runs on the first member agent (not an isolated judge) — a documented limitation of exported team plugins.`

```ts
? `  const engine = createEngine({ dataDir: getHeraDataDir(), cwd: getHeraDataDir(), client: input.client, singleton: true, judgeAgent: ${JSON.stringify(members[0]?.name ?? team.name)} });
```

(Check the actual template context: `members` must be in scope in `generatePluginIndex`; it is a parameter per the Big Bet #1 report. Adapt the property (`.name`) to `AgentDefinition.name`.)

- [ ] **Step 4: Run tests**

Run: `bun test src/generators/ && bun run typecheck`
Expected: PASS (including e2e-build).

- [ ] **Step 5: Commit**

```bash
git add src/generators/plugin-generator.ts src/generators/team-plugin-generator.ts src/generators/plugin-generator.test.ts src/generators/team-plugin-generator.test.ts
git commit -m "feat(export): withEngine plugins pass their own agent as llm_judge backend"
```

---

### Task 8: Docs + full gate

**Files:**
- Modify: `README.md` (acceptance-checks / task-engine section), `CLAUDE.md` (§8 background engine), `ARCHITECTURE.md` (engine section)

- [ ] **Step 1: README** — in the task/acceptance documentation: document the analytic `llm_judge` shape (criteria with `requirement/weight/critical`, `samples`, `evidence.files`), the four `hera.json` fields (`judge_model`, `judge_samples_default`, `judge_timeout_ms`, `judge_evidence_max_bytes`), the `hera-judge` built-in agent (zero tools, temperature 0.1), and the fail-closed behaviors. One worked example:

```json
{
  "type": "llm_judge",
  "rubric": [
    { "requirement": "the summary covers all three incidents", "weight": 2 },
    { "id": "cites", "requirement": "every claim cites a source file", "critical": true }
  ],
  "threshold": 0.75,
  "samples": 3,
  "evidence": { "files": ["report.md"] }
}
```

- [ ] **Step 2: CLAUDE.md §8** — add two sentences: acceptance criteria validation now includes the analytic LLM judge (`src/engine/judge.ts`, RubricJudge; verdicts persist on `TaskRecord.proof[].verdict`); the judge runs on the injected zero-tool `hera-judge` agent, configurable via `judge_*` config fields and `EngineOptions.judgeAgent`.

- [ ] **Step 3: ARCHITECTURE.md** — engine section: add `judge.ts` row to the module table (evidence → prompt → k samples → median aggregate → verdict) and note the `hera-judge` injection in the plugin-initialization flow.

- [ ] **Step 4: Verify docs claims against code** — grep the three docs for "llm_judge": every described field must exist in `acceptance-schema.ts`; the config fields must match `HeraConfig`.

- [ ] **Step 5: Full release gate**

Run: `bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md ARCHITECTURE.md
git commit -m "docs: analytic LLM-as-judge acceptance (README, CLAUDE.md, ARCHITECTURE)"
```

---

## Task dependency order

1 → 2 → 3 → 4 → 5 (spine, sequential; 2 also touches constants.ts)
6 needs 1+2 (verdict type + JUDGE_DEFAULT_THRESHOLD) — parallel-safe with 3/4/5 (disjoint files)
7 needs 4 (EngineOptions.judgeAgent) — parallel-safe with 5 (disjoint files) and 6
8 last.

Orchestration groups (Workflow, BB1 method): Phase A: T1 → T2 → then parallel(lane {T3 → T4 → T5}, lane {T6}); Phase B: T7 (after T4; can run parallel with T5/T6 if staged accordingly — simplest: run T7 in Phase B alone); Phase C: T8 docs + controller gate. Implementers run ONLY their task's targeted tests during parallel lanes; the controller runs the full gate and commits per task/group.
