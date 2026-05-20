import { describe, it, expect } from "bun:test";
import { proposeEvolution } from "./auto-evolve.js";

describe("proposeEvolution", () => {
  it("detects SQL injection pattern", () => {
    const result = proposeEvolution("Failed to prevent SQL injection in the login query");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("parameterized");
    expect(result!.observation).toBe("Auto-detected failure pattern");
    expect(result!.rolledBack).toBe(false);
    expect(typeof result!.timestamp).toBe("number");
  });

  it("detects null pointer pattern", () => {
    const result = proposeEvolution("TypeError: cannot read property 'name' of undefined");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("null");
    expect(result!.directive).toContain("optional chaining");
  });

  it("detects race condition pattern", () => {
    const result = proposeEvolution("Race condition detected in async concurrent access");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("async");
  });

  it("detects memory leak pattern", () => {
    const result = proposeEvolution(
      "Memory leak detected — event listeners not cleaned up properly"
    );
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("clean up");
    expect(result!.directive).toContain("resources");
  });

  it("detects XSS pattern", () => {
    const result = proposeEvolution("XSS vulnerability found — user input not sanitized");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("sanitize");
  });

  it("detects performance/timeout pattern", () => {
    const result = proposeEvolution("Request timeout — slow query performance needs optimize");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("profile");
  });

  it("detects test failure pattern", () => {
    const result = proposeEvolution(
      "Test fail: assertion error in integration test, coverage below threshold"
    );
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("tests");
  });

  it("truncates long failure context in trigger field", () => {
    const longContext = "A".repeat(200);
    const result = proposeEvolution(`SQL injection found: ${longContext}`);
    expect(result).not.toBeNull();
    expect(result!.trigger.length).toBeLessThanOrEqual(100);
  });

  it("returns null for unrecognized patterns", () => {
    const result = proposeEvolution("Everything worked fine, no issues detected.");
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = proposeEvolution("");
    expect(result).toBeNull();
  });

  it("returns null for generic error without pattern match", () => {
    const result = proposeEvolution("Unknown error occurred in module XYZ.");
    expect(result).toBeNull();
  });

  it("matches first pattern when multiple overlap", () => {
    // Both "injection" and "async" patterns match — should return first match
    const result = proposeEvolution("SQL injection found with async race condition");
    expect(result).not.toBeNull();
    expect(result!.directive).toContain("parameterized");
  });
});
