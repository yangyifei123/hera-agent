# Hera Agent Modes

Hera agents have three modes. Pick the mode based on how the agent will be called.

| Mode | Can you call it directly with `opencode --agent name`? | Use when | Default examples |
|------|---------------------------------------------------------|----------|------------------|
| `all` | Yes | You want to use the agent yourself and also let other agents call it. This is the safest default. | coder, debugger, architect |
| `primary` | Yes | The agent acts as a main coordinator or lead agent. | hera, team coordinator |
| `subagent` | No | The agent is a specialist invoked by Hera or another agent. | reviewer, tester, documenter |

## Decision rule

If you expect to type this:

```bash
opencode --agent my-agent "do work"
```

create the agent with `mode: all` unless you have a specific reason to use `primary`.

If the agent should only be a worker inside a team, use `mode: subagent`.

## Common mistake

Creating a reviewer with `mode: subagent` and then trying to call it directly will feel like the agent disappeared. It has not disappeared; OpenCode hides subagents from direct `--agent` use. Recreate it with `mode: all` if you want direct access.

## Examples

```bash
# Directly callable coder
hera create agent my-coder --template coder --mode all

# Team-only reviewer
hera create agent review-worker --template reviewer --mode subagent

# Coordinator/lead agent
hera create agent delivery-lead --template coordinator --mode primary
```
