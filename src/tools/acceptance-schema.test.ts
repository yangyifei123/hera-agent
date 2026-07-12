import { describe, it, expect } from "bun:test";
import { validateAcceptanceChecks } from "./acceptance-schema.js";

describe("validateAcceptanceChecks", () => {
  it("accepts well-formed checks of every type", () => {
    expect(
      validateAcceptanceChecks([
        { type: "shell", command: "exit 0" },
        { type: "file_exists", path: "x" },
        { type: "regex", source: "output", pattern: "ok" },
        { type: "regex", source: "file", path: "y", pattern: "ok" },
        { type: "llm_judge", rubric: "is it done" },
      ])
    ).toBeNull();
  });

  it("rejects an empty array", () => {
    expect(validateAcceptanceChecks([])).toContain("at least one");
  });

  it("rejects an unknown check type, naming the index", () => {
    const err = validateAcceptanceChecks([{ type: "bogus", foo: 1 }]);
    expect(err).toContain("#0");
    expect(err).toContain("malformed");
  });

  it("rejects a regex/file check with no path (permanently unsatisfiable)", () => {
    const err = validateAcceptanceChecks([{ type: "regex", source: "file", pattern: "x" }]);
    expect(err).toContain('source "file" requires a "path"');
  });
});

describe("llm_judge schema (analytic)", () => {
  it("accepts a plain string rubric (back-compat)", () => {
    expect(validateAcceptanceChecks([{ type: "llm_judge", rubric: "does it work" }])).toBeNull();
  });

  it("accepts an analytic rubric with weights/critical/samples/evidence", () => {
    expect(
      validateAcceptanceChecks([
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
      ])
    ).toBeNull();
  });

  it("rejects an empty criteria array", () => {
    expect(validateAcceptanceChecks([{ type: "llm_judge", rubric: [] }])).not.toBeNull();
  });

  it("rejects samples above the cap and non-[0,1] thresholds", () => {
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "x", samples: 6 }])
    ).not.toBeNull();
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "x", threshold: 1.5 }])
    ).not.toBeNull();
  });

  it("rejects evidence with an empty files array", () => {
    expect(
      validateAcceptanceChecks([{ type: "llm_judge", rubric: "x", evidence: { files: [] } }])
    ).not.toBeNull();
  });

  it("rejects duplicate explicit criterion ids, naming the colliding id", () => {
    const err = validateAcceptanceChecks([
      {
        type: "llm_judge",
        rubric: [
          { id: "docs", requirement: "README documents the flag" },
          { id: "docs", requirement: "CHANGELOG updated", critical: true },
        ],
      },
    ]);
    expect(err).not.toBeNull();
    expect(err).toContain('"docs"');
  });

  it("rejects explicit ids that collide after trimming", () => {
    const err = validateAcceptanceChecks([
      {
        type: "llm_judge",
        rubric: [
          { id: " docs ", requirement: "a" },
          { id: "docs", requirement: "b" },
        ],
      },
    ]);
    expect(err).not.toBeNull();
    expect(err).toContain('"docs"');
  });

  it("rejects an explicit id colliding with an auto-assigned c<n> id", () => {
    // Criterion #0 has no id, so normalization assigns it "c1" — which the
    // explicit id of criterion #1 collides with.
    const err = validateAcceptanceChecks([
      {
        type: "llm_judge",
        rubric: [{ requirement: "a" }, { id: "c1", requirement: "b" }],
      },
    ]);
    expect(err).not.toBeNull();
    expect(err).toContain('"c1"');
  });

  it("accepts explicit ids that do not collide with auto-assigned ones", () => {
    expect(
      validateAcceptanceChecks([
        {
          type: "llm_judge",
          rubric: [{ requirement: "a" }, { id: "c2", requirement: "b" }],
        },
      ])
    ).toBeNull();
  });
});
