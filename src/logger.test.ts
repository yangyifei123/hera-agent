import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { heraLog, setLogLevel, resetLogLevel, type LogLevel } from "./logger.js";

describe("heraLog", () => {
  const originalConsoleError = console.error;
  let calls: Array<{ args: unknown[] }> = [];

  beforeEach(() => {
    calls = [];
    console.error = mock((...args: unknown[]) => {
      calls.push({ args });
    });
    resetLogLevel();
    delete process.env.HERA_LOG_LEVEL;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    resetLogLevel();
    delete process.env.HERA_LOG_LEVEL;
  });

  describe("default level (warn)", () => {
    test("warn logs output", () => {
      heraLog("warn", "something happened");
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toContain("[Hera] [WARN]");
      expect(calls[0].args[0]).toContain("something happened");
    });

    test("info is suppressed by default", () => {
      heraLog("info", "info message");
      expect(calls.length).toBe(0);
    });

    test("debug is suppressed by default", () => {
      heraLog("debug", "debug message");
      expect(calls.length).toBe(0);
    });
  });

  describe("info level", () => {
    beforeEach(() => {
      setLogLevel("info");
    });

    test("warn logs output", () => {
      heraLog("warn", "warn msg");
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toContain("[Hera] [WARN]");
    });

    test("info logs output", () => {
      heraLog("info", "info msg");
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toContain("[Hera] [INFO]");
    });

    test("debug is suppressed", () => {
      heraLog("debug", "debug msg");
      expect(calls.length).toBe(0);
    });
  });

  describe("debug level", () => {
    beforeEach(() => {
      setLogLevel("debug");
    });

    test("all levels log output", () => {
      heraLog("debug", "debug msg");
      heraLog("info", "info msg");
      heraLog("warn", "warn msg");
      expect(calls.length).toBe(3);
    });

    test("debug format is correct", () => {
      heraLog("debug", "trace");
      expect(calls[0].args[0]).toContain("[Hera] [DEBUG]");
    });
  });

  describe("with data parameter", () => {
    test("data is included as second argument", () => {
      heraLog("warn", "error occurred", { code: 42 });
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toContain("[Hera] [WARN]");
      expect(calls[0].args[0]).toContain("error occurred");
      expect(calls[0].args[1]).toEqual({ code: 42 });
    });

    test("data with debug level when enabled", () => {
      setLogLevel("debug");
      heraLog("debug", "details", { key: "value" });
      expect(calls.length).toBe(1);
      expect(calls[0].args[1]).toEqual({ key: "value" });
    });

    test("data is not logged when level is suppressed", () => {
      heraLog("info", "should not appear", { secret: true });
      expect(calls.length).toBe(0);
    });
  });

  describe("setLogLevel / resetLogLevel", () => {
    test("setLogLevel overrides env var", () => {
      process.env.HERA_LOG_LEVEL = "warn";
      setLogLevel("debug");
      heraLog("debug", "should appear");
      expect(calls.length).toBe(1);
    });

    test("resetLogLevel re-reads env var", () => {
      process.env.HERA_LOG_LEVEL = "debug";
      setLogLevel("warn");
      heraLog("debug", "should not appear");
      expect(calls.length).toBe(0);

      resetLogLevel();
      heraLog("debug", "should appear after reset");
      expect(calls.length).toBe(1);
    });
  });

  describe("HERA_LOG_LEVEL env var", () => {
    test("HERA_LOG_LEVEL=debug enables all levels", () => {
      process.env.HERA_LOG_LEVEL = "debug";
      resetLogLevel();
      heraLog("debug", "d");
      heraLog("info", "i");
      heraLog("warn", "w");
      expect(calls.length).toBe(3);
    });

    test("HERA_LOG_LEVEL=info enables info and warn", () => {
      process.env.HERA_LOG_LEVEL = "info";
      resetLogLevel();
      heraLog("debug", "d");
      heraLog("info", "i");
      heraLog("warn", "w");
      expect(calls.length).toBe(2);
    });

    test("HERA_LOG_LEVEL=warn (default) enables only warn", () => {
      process.env.HERA_LOG_LEVEL = "warn";
      resetLogLevel();
      heraLog("debug", "d");
      heraLog("info", "i");
      heraLog("warn", "w");
      expect(calls.length).toBe(1);
    });

    test("HERA_LOG_LEVEL with uppercase works", () => {
      process.env.HERA_LOG_LEVEL = "DEBUG";
      resetLogLevel();
      heraLog("debug", "d");
      expect(calls.length).toBe(1);
    });

    test("invalid HERA_LOG_LEVEL falls back to warn", () => {
      process.env.HERA_LOG_LEVEL = "trace";
      resetLogLevel();
      heraLog("info", "i");
      expect(calls.length).toBe(0);
    });
  });

  describe("output format", () => {
    test("format is [Hera] [LEVEL] message", () => {
      heraLog("warn", "test message");
      const output = calls[0].args[0] as string;
      expect(output).toMatch(/^\[Hera\] \[WARN\] test message$/);
    });
  });
});