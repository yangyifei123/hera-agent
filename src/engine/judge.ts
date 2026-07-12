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

/**
 * Normalize a rubric into criteria with GUARANTEED-unique ids. Duplicate ids
 * (explicit repeats, or a generated index id colliding with an explicit id)
 * would let one judge entry satisfy two criteria — e.g. copying a passing
 * score onto a never-evaluated critical criterion — so generated ids skip
 * every explicit id and explicit repeats are uniquified with a `-N` suffix.
 */
export function normalizeCriteria(rubric: string | RubricCriterion[]): NormalizedCriterion[] {
  if (typeof rubric === "string") {
    const requirement = rubric.trim();
    return requirement ? [{ id: "c1", requirement, weight: 1, critical: false }] : [];
  }
  const entries = rubric.filter(
    (c) => typeof c.requirement === "string" && c.requirement.trim().length > 0
  );
  const reserved = new Set<string>();
  for (const c of entries) {
    const id = c.id?.trim();
    if (id) reserved.add(id);
  }
  const used = new Set<string>();
  return entries.map((c, i) => {
    let id = c.id?.trim() ?? "";
    if (!id) {
      let n = i + 1;
      id = `c${n}`;
      while (reserved.has(id) || used.has(id)) id = `c${++n}`;
    } else if (used.has(id)) {
      let n = 2;
      let candidate = `${id}-${n}`;
      while (reserved.has(candidate) || used.has(candidate)) candidate = `${id}-${++n}`;
      id = candidate;
    }
    used.add(id);
    return {
      id,
      requirement: c.requirement.trim(),
      weight: typeof c.weight === "number" && c.weight > 0 ? c.weight : 1,
      critical: c.critical === true,
    };
  });
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
 * to [0,1]. Duplicate entries for a known id keep the FIRST occurrence
 * (spec §8 "extras ignored") — the untrusted work output is embedded in the
 * judge prompt, so a later injected entry must not override an honest score.
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
    if (out.has(id)) continue; // duplicate known id: first occurrence wins
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
      scores.length % 2 === 1
        ? scores[(scores.length - 1) / 2]
        : (scores[mid - 1] + scores[mid]) / 2;
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
