# Progressive Disclosure + Tool Catalog Retrieval — Design

**Date:** 2026-07-11
**Status:** Approved (brainstorm complete; awaiting implementation plan)
**Big Bet:** #1 of 4 (see docs/internal/HERA_AUDIT_2026-06.md "Big bets")

## 1. Goals and non-goals

### Goals

1. **Context reduction.** Child agents and Hera itself stop carrying ~75 `hera_*`
   tool schemas plus full skill bodies in every context window. Agents get a
   small native "hot set" of tools plus a searchable catalog; skills appear as a
   compact manifest and are loaded on demand.
2. **One prompt truth.** The three prompt-assembly paths — live injection
   (`config` hook in `src/index.ts`), disk rendering (`buildAgentPrompt` in
   `src/agents/hera.ts`), and plugin export (`src/generators/*`) — all render
   the same skill manifest from one shared function. This permanently fixes the
   CLAUDE.md §4 "sharp edge" (disk/export paths embedding ~27KB of full skill
   bodies while the live path uses a manifest).
3. **Security parity.** Dispatched tool calls are checked and validated exactly
   as strictly as natively registered calls: per-agent authorization plus
   argument schema validation are re-enforced inside the dispatcher.

### Non-goals

- No embeddings or vector retrieval anywhere in this feature. Retrieval is
  deterministic local keyword scoring. ("Tool RAG" was an early nickname; the
  feature is **tool catalog retrieval**.)
- No SQLite/FTS5 for the tool catalog. The catalog's source of truth is code;
  it is derived in memory at startup and can never go stale. SQL-based
  retrieval (SAG-style, cf. arXiv 2606.15971) is reserved for Big Bet #4
  (strategy memory + hybrid retrieval), where data grows unboundedly and needs
  persistence.
- No rewrite of the 14 existing tool-domain factories merged by
  `createAllTools()` (agent, skill, team, memory, evolution, system, package,
  workflow, task, loop, recovery, program, program-scaffold, command — note
  CLAUDE.md's "11 domains" is stale). The only touch to existing tool code is
  preserving domain labels at the merge point in `src/tools/index.ts`.

## 2. Core concept: authorization vs. native registration

These are two distinct layers and must never be conflated:

- **Authorization** (may the agent use tool T at all): decided by the agent
  definition's `tools: Record<string, boolean>` allow/deny map plus
  `hera.json` `disabled_tools`. Default: all `hera_*` tools allowed unless
  explicitly denied.
- **Native registration** (is T's full schema present in the agent's context):
  `nativeTools` (new optional per-agent field) ∩ authorization.

The hot set is purely a performance knob — changing it never changes what an
agent is allowed to do. Meta-dispatch covers exactly the set
`authorized \ natively-registered`. The dispatcher's security question is
always "would the native path have allowed this?" and nothing else.

**Default hot sets** (constants in `src/constants.ts`, overridable per agent
via `nativeTools`):

- Child agents (5): `hera_find_tools`, `hera_run_tool`, `hera_load_skill`,
  `hera_remember`, `hera_recall`.
- Hera itself: the 5 above + the three factory-core domains (agent-tools,
  skill-tools, team-tools; ≈30 tools). The long tail (workflow, task, loop,
  recovery, package, evolution, program, program-scaffold, command, system,
  and the rest of the memory domain) is dispatched.

## 3. New module `src/dispatch/`

Data flow:

```
createAllTools() ── merged map + domain labels ──▶ ToolCatalog (in memory)
  ├▶ config hook: hot set ∩ policy → per-agent tools allow/deny map
  ├▶ hera_find_tools: search (results pre-filtered by caller's policy)
  └▶ hera_run_tool: policy check → zod validation → execute passthrough
```

### 3.1 `catalog.ts` — ToolCatalog

Built once at plugin startup from the merged tool map. Entry per tool:
`{ name, domain, description, argsShape (zod raw shape) }`.

- `search(query, { domain?, limit = 8 })` — tokenized keyword scoring:
  name-token hits weigh more than description hits; exact domain match boosts;
  deterministic tie-break by name. No randomness, no network, unit-testable.
- `listDomains()` — domains with tool counts.
- `byDomain(domain)` — enumerate a domain.

Prerequisite change: `createAllTools()` in `src/tools/index.ts` currently
merges domain maps and discards which domain each tool came from. The merge
keeps a `name → domain` label map alongside (existing 11 domain files
unchanged).

### 3.2 `policy.ts`

`effectivePolicy(agentName)` resolves the authorization layers in order:

1. agent definition `tools` map (explicit false = deny),
2. `hera.json` `disabled_tools` (global deny; the catalog never contains these
   because `createAllTools()` already filters them at the merge — the policy
   check here is belt-and-braces for direct dispatch attempts),
3. built-in rule: the meta-tools themselves are never dispatchable
   (`hera_run_tool` cannot invoke `hera_run_tool`/`hera_find_tools`).

Standalone and unit-testable; used by both meta-tools and the config hook.

### 3.3 `meta-tools.ts`

- **`hera_find_tools({ query?, domain?, limit? })`** — searches the catalog.
  Results are pre-filtered by the caller's effective policy (caller identity =
  `ToolContext.agent`, verified available in
  `@opencode-ai/plugin` `ToolContext`): denied or disabled tools never appear.
  Called with no arguments → returns the domain list with counts (browse mode).
  Each result: name, one-line description, compact args summary, domain.
- **`hera_run_tool({ tool, args })`** — five steps:
  1. resolve `tool` in the catalog (unknown → did-you-mean, see §7),
  2. authorization check via `effectivePolicy(context.agent)`,
  3. validate `args` with `z.object(argsShape).safeParse`,
  4. forward to the target tool's `execute(parsedArgs, context)` with the
     original `ToolContext` passed through unchanged,
  5. return the target's result verbatim.

## 4. Config hook changes (`src/index.ts`)

For every injected agent (Hera and children):

- Compute native set = hot set ∩ authorization; write the OpenCode agent
  config `tools` allow/deny map so only the native set is registered. Concrete
  mechanism: explicit `false` entries for non-native `hera_*` tools; if
  OpenCode supports wildcard patterns (e.g. `"hera_*": false` + specific
  allows), use that instead. **The wildcard semantics are the design's only
  open verification point — resolve during implementation planning.**
- Append a short "tool catalog primer" section to the system prompt (domain
  list with counts, find→run usage, one example), sitting alongside the
  existing skill-manifest section.

## 5. Skill manifest unification (fixes CLAUDE.md §4 drift)

One shared renderer, three call sites:

- New function (e.g. `renderSkillManifest(def, skillManager)`) producing the
  compact manifest section (skill names + one-line descriptions +
  `SKILL_DISCLOSURE_INSTRUCTION`).
- **Live path** (`config` hook): already manifest-shaped; switch to the shared
  function.
- **Disk path** (`buildAgentPrompt`, `src/agents/hera.ts`): switch from
  embedding all built-in + user skill bodies (~27KB) to the manifest (~2KB).
- **Export path** (generators): embed the manifest, ship bodies as files (§6).

**Migration:** one-time idempotent pass at plugin startup — any agent `.md`
whose body contains legacy embedded skill sections is rewritten to the
manifest form via `backupAgent()` + `atomicWriteText`. Re-running is a no-op.

**CLI parity:** `bin/hera.js` `buildAgentMarkdown` emits the same manifest
form; the existing promptB64 round-trip tests guard equivalence.

## 6. Exported plugins go progressive too

`plugin-generator.ts` and `team-plugin-generator.ts`:

- Prompt embeds the skill manifest, not bodies.
- Skill bodies ship as files inside the generated plugin:
  `skills/<name>/SKILL.md`.
- Generator emits a lightweight plugin-namespaced loader tool (e.g.
  `<plugin>_load_skill`) that reads those files on demand — namespaced to
  avoid collision when Hera is installed alongside the exported plugin.
- Exported plugins do **not** get find/run meta-tools: they carry only their
  own few tools; there is no catalog worth searching. Keep exports minimal.

## 7. Error handling (dispatcher never throws to the session)

All failures return actionable text:

- **Unknown tool** → top-3 did-you-mean suggestions (reusing the catalog
  scorer) + pointer to `hera_find_tools`.
- **Denied** → names the denying layer (agent `tools` map vs.
  `disabled_tools`).
- **Invalid args** → zod issue list + a readable rendering of the expected
  args schema.
- **Target tool throws** → caught; returned as an error string naming the tool.
  A dispatch failure must never crash the session.

## 8. Testing and acceptance

- `catalog.test.ts` — extraction from a fake merged map; scoring determinism;
  domain browse; disabled tools excluded.
- `policy.test.ts` — allow/deny matrix across the three layers.
- `meta-tools.test.ts` — five paths: success, unknown tool, denied, invalid
  args, target-throws.
- **Manifest-parity regression test** — asserts `buildAgentPrompt` output and
  the config-hook prompt contain the identical manifest section (pins §4
  closed forever).
- Generator tests — exported plugin contains `skills/` files + namespaced
  loader + manifest prompt; generated plugin installs and parses.
- Round-trip — create → persist → parse → identical definition (including new
  `nativeTools` field).
- CLI alignment — `bin/hera.js` markdown matches plugin-side rendering.

**Expected wins:** child-agent native tool schemas ~75 → 5; disk agent `.md`
~27KB → ~2KB; Hera's own context reduced by the long-tail domains (~40
schemas).

**Accepted trade-offs (explicit user decisions):** long-tail tool calls become
two-hop (find → run); dispatched calls lose OpenCode-native arg validation and
per-tool permission *at the harness layer* — both are re-implemented at full
parity inside the dispatcher (§2, §3.3).

## 9. Decision log (brainstorm 2026-07-10 → 2026-07-11)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Both skill-disclosure-everywhere and tool catalog retrieval |
| 2 | Retrieval mechanism | Meta-dispatch (`hera_find_tools` + `hera_run_tool`) |
| 3 | Native set | Meta-tools + small hot set, per-agent configurable data |
| 4 | Permission model | Full parity rebuild inside dispatcher |
| 5 | Ranking | Keyword scoring + domain browse; no embeddings |
| 6 | Hera itself | Same mechanism, larger default hot set |
| 7 | Catalog storage | In-memory derived; SQL/FTS5 deferred to Big Bet #4 |
| 8 | Exports | Progressive: manifest + shipped skill files + namespaced loader |
| 9 | Architecture | `src/dispatch/` first-class module (catalog/policy/meta-tools) |
