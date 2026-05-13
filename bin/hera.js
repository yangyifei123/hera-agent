#!/usr/bin/env node
// hera — CLI for Hera Agent Factory

const args = process.argv.slice(2);
const cmd = args[0] || "help";

switch (cmd) {
  case "version":
  case "-v":
    console.log("hera-agent v2.0.0");
    break;

  case "install":
    console.log(`
Hera Agent Factory — Installation

Method 1: From npm (Recommended)
  opencode plugin hera-agent --global -f

  Or manually:
  cd ~/.config/opencode && bun add hera-agent

Method 2: From GitHub ZIP
  1. Extract the ZIP file
  2. cd path/to/extracted/hera-agent
  3. bun install && bun run build (if dist/ is missing)
  4. cd ~/.config/opencode
  5. bun add file:///path/to/hera-agent

  Example: bun add file:///E:/Downloads/hera-agent-2.0.0

Verify:
  1. Check opencode.json contains: { "plugin": ["hera-agent"] }
  2. Test: opencode agent list | grep hera
  3. Launch: opencode --agent hera
`);
    break;

  case "uninstall":
    console.log(`
Hera Agent Factory — Uninstall

Complete Uninstall (removes everything):
  1. Edit ~/.config/opencode/opencode.json - remove "hera-agent" from plugin array
  2. cd ~/.config/opencode && bun remove hera-agent
  3. rm -rf ~/.config/opencode/hera-data/
  4. rm -rf ~/.config/opencode/agents/hera/
  5. rm -f ~/.config/opencode/hera.json

Keep Data (reinstall later):
  1. Edit ~/.config/opencode/opencode.json - remove "hera-agent" from plugin array
  2. cd ~/.config/opencode && bun remove hera-agent
  (Your agents, skills, and memory will be preserved)
`);
    break;

  case "list":
    console.log("Hera Agent Factory — Registered Agents & Teams");
    console.log("Run: opencode run --agent hera 'list all agents and teams'");
    break;

  case "help":
  default:
    console.log(`
Hera Agent Factory v2.0.0

Commands:
  hera install     Show installation instructions
  hera uninstall   Show uninstall instructions
  hera list        Show registered agents and teams
  hera version     Show version
  hera help        Show this help

Usage:
  opencode --agent hera              Start Hera agent
  opencode --agent <agent-name>      Start a Hera-created agent
  opencode run --agent hera "..."    Run a single command

Built-in Skills:
  caveman       Ultra-compressed communication (~75% token savings)
  init          Environment awareness and project detection
  skill-combo   Dynamic skill composition
  memory        Autonomous memory management
  evolution     Self-improvement through reflection

Agent Templates:
  general       Versatile assistant
  coder         Coding expert
  reviewer      Code review specialist
  researcher    Research analyst
  coordinator   Team coordinator
`);
    break;
}
