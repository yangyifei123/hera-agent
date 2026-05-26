# Hera Showcase: 10 Copy-Paste Recipes

These recipes are designed for quick demos and real project adoption.

## 1. Code reviewer

```bash
hera create agent my-reviewer --template reviewer --mode all
opencode --agent my-reviewer "review src/index.ts for correctness and security"
```

## 2. Project memory

```bash
opencode run --agent hera "remember: this repo uses strict TypeScript, Bun tests, and .js import extensions"
opencode run --agent hera "recall: TypeScript conventions"
```

## 3. Parallel review team

```bash
opencode run --agent hera "create review-team with my-reviewer and bug-hunter, mode: parallel"
opencode run --agent hera "spawn review-team to review the current diff"
```

## 4. Debugging agent

```bash
hera create agent bug-surgeon --template debugger --mode all
opencode --agent bug-surgeon "investigate this failing test and explain the root cause"
```

## 5. Sequential dev team

```bash
opencode run --agent hera "create dev-team with architect, senior-dev, and qa-engineer, mode: sequential"
opencode run --agent hera "spawn dev-team to design, implement, and test a small feature"
```

## 6. Documentation worker

```bash
hera create agent docs-worker --template documenter --mode all
opencode --agent docs-worker "update README quickstart for the latest CLI commands"
```

## 7. Performance optimizer

```bash
hera create agent perf-lens --template optimizer --mode all
opencode --agent perf-lens "find avoidable bottlenecks in src/workflow"
```

## 8. Skill-to-agent upgrade

```bash
opencode run --agent hera "upgrade skill security to agent security-reviewer, dry_run: true"
opencode run --agent hera "upgrade skill security to agent security-reviewer, mode: all"
```

## 9. Session distillation

```bash
opencode run --agent hera "distill this session into reusable decisions and patterns"
opencode run --agent hera "recall: decisions from the last session"
```

## 10. Package and share an agent

```bash
opencode run --agent hera "package my-reviewer agent with memory"
opencode run --agent hera "export my-reviewer as plugin"
```
