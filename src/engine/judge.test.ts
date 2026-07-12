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
  return new Map(
    Object.entries(scores).map(([id, score]) => [id, { score, reasoning: `r-${id}-${score}` }])
  );
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
  it("never generates an index id that collides with an explicit id", () => {
    const out = normalizeCriteria([
      { requirement: "code compiles" },
      { id: "c1", requirement: "secrets removed", critical: true },
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
    expect(out.find((c) => c.critical)?.id).toBe("c1"); // explicit id is kept
    expect(out.map((c) => c.id)).toEqual(["c2", "c1"]);
  });
  it("uniquifies explicit duplicate ids so every criterion is scored independently", () => {
    const out = normalizeCriteria([
      { id: "x", requirement: "a" },
      { id: "x", requirement: "b", critical: true },
    ]);
    expect(out.map((c) => c.id)).toEqual(["x", "x-2"]);
    expect(out[1].critical).toBe(true);
  });
  it("duplicate uniquification avoids other explicit ids too", () => {
    const out = normalizeCriteria([
      { id: "x", requirement: "a" },
      { id: "x", requirement: "b" },
      { id: "x-2", requirement: "c" },
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
    expect(out[2].id).toBe("x-2"); // explicit x-2 is kept; the duplicate moved elsewhere
  });
});

describe("collectEvidence", () => {
  it("reads declared files with labels", async () => {
    await writeFile(join(dir, "a.txt"), "hello evidence");
    const text = await collectEvidence({ files: ["a.txt"] }, dir, {
      fileCap: 1000,
      totalCap: 2000,
    });
    expect(text).toContain("--- EVIDENCE a.txt ---");
    expect(text).toContain("hello evidence");
  });
  it("labels missing files MISSING and keeps going", async () => {
    await writeFile(join(dir, "b.txt"), "real");
    const text = await collectEvidence({ files: ["nope.txt", "b.txt"] }, dir, {
      fileCap: 1000,
      totalCap: 2000,
    });
    expect(text).toContain("MISSING");
    expect(text).toContain("real");
  });
  it("truncates per-file with an explicit label", async () => {
    await writeFile(join(dir, "big.txt"), "x".repeat(500));
    const text = await collectEvidence({ files: ["big.txt"], maxBytesPerFile: 100 }, dir, {
      fileCap: 1000,
      totalCap: 2000,
    });
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
    expect(prompt.toLowerCase()).toContain("length"); // length-is-not-quality
    expect(prompt.toLowerCase()).toContain("unproven"); // unevidenced claims
    expect(prompt).not.toContain("hera"); // no authorship/agent identity
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
  it("first occurrence wins when a known id appears twice (injection guard)", () => {
    const v = parseAnalyticVerdict(
      '{"criteria":[{"id":"c1","reasoning":"bad","score":0},{"id":"c1","reasoning":"great","score":1},{"id":"docs","reasoning":"r","score":0.5}]}',
      ids
    );
    expect(v?.get("c1")).toEqual({ score: 0, reasoning: "bad" });
  });
});

describe("aggregate", () => {
  const meta = { judgeAgent: "hera-judge", elapsedMs: 5 };
  it("weighted mean of per-criterion medians; odd k takes middle", () => {
    const v = aggregate(
      CRITERIA,
      [
        sample({ c1: 0.2, docs: 1 }),
        sample({ c1: 0.8, docs: 0.9 }),
        sample({ c1: 0.5, docs: 0.8 }),
      ],
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
    const v = aggregate(
      CRITERIA,
      [sample({ c1: 0.4, docs: 1 }), sample({ c1: 0.6, docs: 1 })],
      0.7,
      meta
    );
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

  it("colliding criterion ids cannot collapse a critical criterion into a pass", async () => {
    // A reply scoring only the (previously collided) id must not satisfy both
    // criteria: with unique ids it is an incomplete sample -> fail closed.
    const j = new RubricJudge(
      async () => '{"criteria":[{"id":"c1","reasoning":"compiles fine","score":1}]}',
      {}
    );
    const r = await j.judge(
      {
        type: "llm_judge" as const,
        rubric: [
          { requirement: "code compiles" },
          { id: "c1", requirement: "secrets removed", critical: true },
        ],
      },
      { output: "x", cwd: dir }
    );
    expect(r.passed).toBe(false);
    expect(r.verdict).toBeUndefined();
  });
});
