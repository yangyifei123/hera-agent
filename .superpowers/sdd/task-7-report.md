# Task 7 Report: Config + Constants for the Task Engine

## Summary

Task 7 adds 5 task-engine constants, 4 `HeraConfig` fields, and `HeraPaths.tasksDir`, then wires `tasksDir` into every site that constructs a `HeraPaths` object.

---

## Files Changed

### `src/constants.test.ts`
- Added `it` to the bun:test import (needed for `it()` in the new describe block).
- Added imports for the 5 new constants: `TASK_CONCURRENCY`, `TASK_DEFAULT_MAX_ATTEMPTS`, `TASK_DEFAULT_BACKOFF_MS`, `TASK_LEASE_MS`, `SUPERVISOR_TICK_MS`.
- Appended a new top-level `describe("Task Engine Constants")` block asserting exact values and the invariant `TASK_LEASE_MS > SUPERVISOR_TICK_MS`.

### `src/constants.ts`
- Added a `// === Task Engine Configuration ===` block at the end with the 5 new exports:
  - `TASK_CONCURRENCY = 8`
  - `TASK_DEFAULT_MAX_ATTEMPTS = 3`
  - `TASK_DEFAULT_BACKOFF_MS = 1000`
  - `TASK_LEASE_MS = 300000`
  - `SUPERVISOR_TICK_MS = 500`

### `src/types.ts`
- Extended `HeraConfig` with 4 optional task fields after `memory_ttl_ms`:
  - `task_concurrency?: number`
  - `task_default_max_attempts?: number`
  - `task_default_backoff_ms?: number`
  - `task_lease_ms?: number`
- Extended `HeraPaths` with `tasksDir: string` (after `memoryDir`).

### `src/index.ts`
- Added `tasksDir: join(configRoot, "hera-data", "tasks")` to the `HeraPaths` literal (sibling of `memoryDir: join(configRoot, "hera-data", "memory")`).

### `src/tools/test-harness.ts`
- Added `tasksDir: join(dataDir, "tasks")` to the `paths` object in `makeTestHarness()` (sibling of `memoryDir` which is `join(dataDir, "memory")`).

### `src/index.test.ts`
- Added `tasksDir: join(base, "hera-data", "tasks")` to the `paths` literal in the test helper (the dataDir equivalent is `join(base, "hera-data")`).

### `src/onboarding.test.ts`
- Added `tasksDir: join(tmp, "hera-data", "tasks")` to the `paths` literal in `beforeEach` (sibling of `memoryDir: join(tmp, "hera-data", "memory")`).

---

## HeraPaths Construction Sites Found and Edited

| File | Line (approx) | `dataDir` variable | `tasksDir` expression added |
|------|--------------|-------------------|-----------------------------|
| `src/index.ts` | 84 | `join(configRoot, "hera-data")` | `join(configRoot, "hera-data", "tasks")` |
| `src/tools/test-harness.ts` | 66 | `dataDir` (local var = `join(tmp, "hera-data")`) | `join(dataDir, "tasks")` |
| `src/index.test.ts` | 43 | `join(base, "hera-data")` | `join(base, "hera-data", "tasks")` |
| `src/onboarding.test.ts` | 22 | `join(tmp, "hera-data")` | `join(tmp, "hera-data", "tasks")` |

---

## Test Output

```
bun test src/constants.test.ts
29 pass
 0 fail
 70 expect() calls
Ran 29 tests across 1 file. [52.00ms]
```

## Typecheck Output

```
Exit: 0
(no TS errors printed)
```

---

## Concerns

None. All sites were unambiguous — the data dir variable was clear from sibling `memoryDir` expressions. The `tasksDir` value is consistently `<dataDir>/tasks` across all sites.
