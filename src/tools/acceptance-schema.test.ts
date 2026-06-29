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
