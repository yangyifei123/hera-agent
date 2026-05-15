
## T1: Setup bun:test + Extract Constants (2026-05-14)

### Patterns
- bun:test is built-in, just import { describe, test, expect } from "bun:test"
- bunfig.toml: coverageReporter = ["text"] only (html not supported), set root to src for path convenience
- DEFAULT_SKILLS is s const ¡ª to use .includes() need (DEFAULT_SKILLS as readonly string[]).includes()
- Spreading s const tuples: [...DEFAULT_SKILLS] creates mutable array for templates that add extras
- { ...DEFAULT_PERMISSION } spread works for const objects
- Pre-existing biome lint errors (noImplicitAnyLet, noAssignInExpressions) in distillation/engine.ts lines 92-93 are not from our changes

### Decisions
- 15 constants extracted covering: agent config (2), team config (3), memory (1), skills (1), permissions (1), distillation (4), recall (2), temperature (not extracted ¡ª used inline as 0.3 which is a domain-specific hyperparameter, not a limit/magic number)
- All constants have same values as original hardcoded numbers ¡ª zero behavior change
## T3: Type OpenCode Client Interface (2026-05-14)

### Patterns
- OpenCodeClient interface in src/types/client.ts covers 4 session methods: create, promptAsync, status, messages
- create() return type uses union { data: { id: string } | string } to handle both SDK versions (createResult.data?.id ?? createResult.data pattern)
- Made client OpenCodeClient | undefined (not just OpenCodeClient) because client is optional â€” hasClient guard checks exist in both tools/index.ts and team/manager.ts
- No s any casts needed removal in tools/index.ts â€” existing hasClient guards provide sufficient type narrowing
- bun:test type-checks interfaces via mock objects â€” validates structure at compile time

### Decisions
- Used | undefined for client type to match reality (client may not be available in all environments)
- Created src/types/ directory for type-only modules (client.ts + client.test.ts)
- Union return type on create() avoids needing to change existing createResult.data?.id ?? createResult.data usage pattern

## T5: Unify Persistence Layer
- Created src/persistence.ts with persistAgent() and removeAgent()
- Replaced 4 scattered 3-call patterns in tools/index.ts with single helper calls
- persistAgent: registeredAgents.set + agentRegistry.register + store.save
- removeAgent: registeredAgents.delete + agentRegistry.unregister + store.delete
- Dead metadata (upgradedFrom, imported:true) replaced with standard {mode, skills, fileWritten}
- 10 tests, 100% coverage on persistence.ts
- Build passes, 65 total tests pass

## T6: Interface Segregation for PluginContext (2026-05-14)

### Patterns
- Used type aliases for import() types (MemoryStore, SkillManager, TeamManager, etc.) to avoid repeating inline import() in every interface
- PluginContext kept intact for backward compat â€” new interfaces are additive
- 6 domain interfaces added: AgentToolCtx, SkillToolCtx, TeamToolCtx, MemoryToolCtx, EvolutionToolCtx, SystemToolCtx
- TeamToolCtx uses client: OpenCodeClient (not | undefined) because team tools require client
- Bun build bundles type-only interfaces without issue â€” no runtime impact

### Decisions
- Used 	ype aliases for import paths instead of inline import() â€” cleaner and reusable
- Interfaces defined after PluginContext so they can reference the same type aliases

## T7: Split Tools Monolith into Domain Files (2026-05-14)

### Patterns
- Barrel pattern: index.ts re-exports from 6 domain files, spread-merged in createAllTools()
- Each domain file exports createXTools(ctx: PluginContext) ¡ª same ctx type for simplicity (domain-specific interfaces exist in types.ts but not needed for this split)
- hera-tools.ts backward compat file already existed, just re-exports from index.js ¡ª untouched
- Build went from 14 modules to 23 modules (each file + its deps), output size barely changed (67.48 KB ¡ú 70.16 KB)
- Team-tools uses store in destructuring but doesn't call it ¡ª kept for consistency with ctx shape

### Decisions
- Used PluginContext (full ctx) for all domain files rather than domain-specific interfaces ¡ª simpler, avoids type casting at call sites
- 23 tools split as: agent(7), skill(4), team(5), memory(2), evolution(4), system(1)
- hera_distill_session placed in evolution-tools since it's closely related to agent knowledge extraction

## T8: Fix DistillationEngine ¡ª Real Messages + Multilingual
- Added 5 Chinese tech keyword patterns to extractPatterns() (frontend, devops, database, auth, testing)
- IMPORTANT: CJK characters don't have word boundaries ¡ª use bare regex without \b for Chinese patterns
- Added Chinese architectural decision patterns: '¾ö¶¨²ÉÓÃ', 'Ñ¡ÓÃ', 'Ñ¡Ôñ', 'Ê¹ÓÃ...¼Ü¹¹/·½°¸/Ä£Ê½/¿ò¼Ü'
- Fixed distillToSkill() missing category: 'user' ¡ª was a type violation bug
- Modified hera_distill_session to fetch real messages via client.session.messages() with graceful fallback
- Fixed biome lint: avoid let + reassignment pattern ¡ª use ternary with const instead
- 14 engine tests covering Chinese + English patterns, bilingual summary, skill creation
- 79 total tests pass, build 71.38 KB

## T9: Wire auto_evolve Config Reading (2026-05-14)

### Patterns
- autoEvolve derived as config.auto_evolve === true (strict boolean, not truthy) to handle undefined/null safely
- Compacting hook appends evolution prompt only when ctx.autoEvolve is true â€” zero-cost when disabled
- PluginContext.autoEvolve is required boolean (not optional) â€” always derived from config at plugin init time
- Test creates temp dirs for MemoryStore/SkillManager/etc â€” needs mkdirSync + recursive

### Decisions
- Used hera_evolve_agent (existing tool) in the evolution prompt, not a hypothetical hera_propose_evolution â€” aligns with actual tool inventory
- Stored autoEvolve as derived boolean on PluginContext rather than reading config.auto_evolve repeatedly in hooks

## T10: Agent Name Validation (2026-05-14)

### Patterns
- Regex ^[a-z][a-z0-9-]*$ alone doesn't reject trailing hyphens ¡ª need explicit 
ame.endsWith('-') check
- Suggestion generation: lowercase ¡ú replace invalid with hyphens ¡ú trim leading/trailing hyphens ¡ú prepend letter if starts with digit ¡ú prepend 'agent-' if empty after transforms
- validateAgentNameWithConflict accepts both Set<string> and Map<string, unknown> ¡ª uses instanceof check
- hera_upgrade_to_agent is in skill-tools.ts, not agent-tools.ts (T7 split)
- Validation goes before any business logic ¡ª fail fast

### Decisions
- Reserved names: hera, opencode, system
- Max length: 50 chars
- Conflict check uses registeredAgents Map directly (in-memory only, not disk ¡ª acceptable since agents load on startup)
- Error messages include suggestion on same line for compact output

## T12: Search/Filter Enhancements for List/Recall (2026-05-14)

### Patterns
- MemoryStore.search added 3rd param as options object { since?, limit? } â€” backward compatible since original signature was (query, type?)
- Word boundary regex \b with i flag added alongside substring fallback â€” both OR'd together
- escapeRegex helper prevents ReDoS from user queries containing [, *, etc.
- hera_list_agents returns { line, def } tuples internally so filters can inspect definitions without double-reading
- hera_recall clamps user-provided limit to max 50 via Math.min(args.limit, 50) before passing to store.search
- MemoryStore tests need wait store.init() in beforeEach â€” save() writes to subdirs like sessions/ that init() creates
- Word boundary gotcha: \btype does NOT match "typing" â€” "type" is not a prefix of "typing" (only "typ" is)
- .slice(0, options?.limit) at end of search results â€” undefined limit passes all through (slice(undefined) returns full array)

## T13: Auto-Memory from Session Compacting (2026-05-14)

### Patterns
- Chinese regex: use \s* not \s+ between Chinese keywords and content (no spaces in Chinese text)
- Chinese punctuation as regex terminators: [\.¡££¬¡¢£»\n]
- Memory store used ${type}s for subdirectory names ¡ª doesn't work for irregular plurals (fix¡úfixs). Added explicit getSubdir() mapping
- HeraMemory type needed extending: added 'decision', 'fix', 'pattern', 'preference', 'context'
- Memory store init() must create all subdirectories upfront or save() fails on missing dir
- Session compacting hook receives input with a messages field ¡ª accessed via (input as any).messages

### Decisions
- auto_memory defaults to false ¡ª opt-in behavior
- Max 5 memories per compaction to avoid noise
- Uses dedicated ID prefix uto-{category}-{uuid} for auto-extracted memories
- Confidence scores: fix=0.9, decision=0.8, pattern=0.7
- Deduplication is case-insensitive

## T15: hera_quick_team Tool with Templates (2026-05-14)

### Patterns
- Team templates use satisfies Record<string, TeamTemplate> for type safety
- Auto-creates agents using createAgentFromTemplate() + persistAgent() ¡ª reuses existing persistence layer
- Agent role name doubles as agent name (e.g., role='reviewer' ¡ú agent named 'reviewer')
- team-tools.ts needed additional ctx destructuring: skillManager, gentRegistry for auto-creation
- 3 templates: code-review (parallel, 2), dev-pipeline (sequential, 3), research (sequential, 2)

### Decisions
- Task spawn is optional via 	ask_description arg ¡ª no auto-spawn without explicit request
- Template member ole is used as both agent name and team role ¡ª simple, predictable
- If agent already exists, skip creation (idempotent) ¡ª allows re-running quick_team
- Tool added to team-tools.ts alongside existing team tools ¡ª not a separate file

## T19: Implement First-Run Onboarding (2026-05-14)

### Patterns
- isFirstRun uses equire("fs").accessSync() for synchronous check during init â€” async check not available at plugin init time
- .onboarded flag stored in hera-data/ (paths.dataDir), not configRoot â€” same location as memory/skills
- runOnboarding takes 5 params: paths, agentRegistry, teamManager, store, skillManager â€” skillManager needed for getSkillMap()
- createAgentFromTemplate("debugger", "quick-fixer") creates AgentDefinition, then registry.register() writes .md file
- Default team dev-team uses predefined agent names (architect, senior-dev, qa-engineer) â€” assumes these exist or will be created
- Error handling via try/catch with heraLog("warn") â€” onboarding doesn't fail plugin init if items already exist
- Called after agentRegistry.init() + ensureHeraMd() but BEFORE loading persisted agents â€” new onboarded agents get loaded in subsequent diskAgentNames loop

### Decisions
- Used debugger template for quick-fixer â€” matches "fast fix agent" intent
- dev-team coordination: sequential â€” pipeline flow (design â†’ implement â†’ test)
- Wrote onboarding flag as JSON { timestamp } for potential future debugging
