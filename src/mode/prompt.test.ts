// src/mode/prompt.test.ts
import { describe, it, expect } from "bun:test";
import { driveModeSystemAddendum } from "./prompt.js";

const ctx = { sessionID: "s1", directory: "/tmp/x" };

describe("driveModeSystemAddendum", () => {
  it("returns null for collab (no addendum, byte-identical to today)", () => {
    expect(driveModeSystemAddendum("collab", ctx)).toBeNull();
  });

  it("returns a non-empty autonomy directive for auto", () => {
    const s = driveModeSystemAddendum("auto", ctx);
    expect(s).not.toBeNull();
    expect(s).toContain("auto");
    expect(s).toContain("hera_enqueue_task");
    expect(s).toContain("hera_create_loop");
  });

  it("returns null for program (no chat turn to shape)", () => {
    expect(driveModeSystemAddendum("program", ctx)).toBeNull();
  });
});
