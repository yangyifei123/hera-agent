# Greek Experiment — Can Hera produce an omo-style plugin?

**Date:** 2026-07-10
**Question:** Can Hera (the agent factory) actually produce a standalone,
installable OpenCode plugin that behaves like *omo* (oh-my-openagent): several
themed agents plus native `/<keyword>` slash-commands — here, a council of Greek
philosophers (`socrates`, `plato`, `aristotle`, `diogenes`) that interpret books
and teach?

**Answer:** Yes, validated end-to-end for the export + persistence + command
capability. Two honest limits remain (a live model and a real running OpenCode
process were intentionally out of scope — see *Limits*).

---

## Hard isolation constraint (honored)

The user's live desktop OpenCode at `C:\Users\Administrator\.config\opencode`
and its configured plugins/skills/tools **must not** be touched. Every step ran
against a sandbox pinned by `HERA_CONFIG_ROOT` to a repo-local, git-ignored
directory `.greek-sandbox/`. No OpenCode process was launched. Post-run checks
confirmed the real config's `command/`, `agents/hera/`, and `hera-data/` contain
**zero** philosopher/greek artifacts.

The isolation lever is `resolveOpenCodeConfigRoot()` in `src/constants.ts`
(`HERA_CONFIG_ROOT` → `OPENCODE_CONFIG_ROOT` → platform default). The generated
plugin's inlined `getCommandDir()` / `getMemoryDir()` honor the same precedence,
so a sandboxed root keeps a generated plugin off a live install.

## Feature added to make this possible

Native OpenCode command files (`<configRoot>/command/<name>.md`, front-matter
`agent:` + `$ARGUMENTS` body) are the keyword mechanism omo uses. This branch
adds:

- `src/commands/command-file.ts` — shared, injection-hardened command-file
  builder/writer.
- `src/tools/command-tools.ts` — `hera_create_command` / `hera_list_commands` /
  `hera_delete_command`.
- Exporters (`plugin-generator.ts`, `team-plugin-generator.ts`) bake an inlined
  `writePluginCommands()` into the generated plugin so it ships its own
  `/<name>` commands on load (`withCommands` default true; ownership-marker
  guard prevents clobbering foreign commands).

## What was validated (all green)

Scripts live under `.greek-sandbox/` (git-ignored). Reproduce from repo root:

| Layer | Script | Result |
|------|--------|--------|
| **Real authorship + persistence** — Hera's own `persistAgent()` (3 backends: in-memory map, `AgentRegistry` `.md` on disk, `MemoryStore` json) + `TeamManager.createTeam()` (client=undefined → definition only, no session spawn), then reload from disk (`AgentRegistry.readDefinition`) + store (`TeamManager.init`), then export from the **reloaded** defs. | `bun .greek-sandbox/dogfood-create.ts` | **19/19** — prompts round-trip through disk; team reloads with all 4 members. |
| **Minimal plugin (withEngine:false)** — build the generated plugin, load the **built** `dist/index.js` in a headless harness, run its `config` hook. | `bun .greek-sandbox/gen.ts` → `bun build …` → `bun .greek-sandbox/harness.ts` | **31/31** — 4 persona-distinct agents inject; 4 `/command` files written & route correctly; `hera_remember`→`hera_recall` round-trips on disk. |
| **Full-engine plugin (withEngine:true)** — generate + build the engine variant (bundles `hera-agent/engine` via a temporary repo-local self-link), load it. | `bun .greek-sandbox/engine-variant-gen.ts` → `bun build …` → `bun .greek-sandbox/engine-variant-harness.ts` | **ALL PASSED** — engine boots; `hooks.tool` exposes **17** tools incl. `hera_enqueue_task`, `hera_create_loop`, `hera_engine_health`, `hera_list_tasks` + the 4 agents + 4 commands. |

## Limits (intentional, honest)

1. **No live model.** "Behaves like Socrates" is proven at the *prompt/persona*
   level (distinct method vocabulary baked into each agent), not by invoking an
   LLM — a headless harness has no model.
2. **Not run inside a real OpenCode process.** Launching OpenCode was excluded
   to honor the isolation constraint. Agent injection is proven by driving the
   `config` hook directly with a stand-in input; OpenCode's own loader/autocomplete
   was not exercised.
3. **`withEngine:true` needs `hera-agent` resolvable at build.** In a real
   install this is satisfied by the dependency the generated `package.json`
   declares (`hera-agent`). Here it was resolved with a temporary, repo-local
   self-link that was removed afterward.

## Verdict

Hera's export/persistence pipeline genuinely **produces** the greek plugin — it
authors and persists the agents/team through its real modules, reloads them, and
emits a standalone plugin that injects themed agents, ships `/<keyword>` commands,
and (with the engine) exposes background-orchestration tools. That is the omo
capability, demonstrated against real built artifacts under strict isolation.
