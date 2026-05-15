import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

function getConfigRoot(): string {
  const envDir = process.env.HERA_DIR;
  if (envDir) return resolve(envDir);
  return resolve(homedir(), ".config", "opencode");
}

const CONFIG_ROOT = getConfigRoot();
const AGENTS_DIR = join(CONFIG_ROOT, "agents", "hera");
const HERA_DIR = join(CONFIG_ROOT, "hera-data");

function getArgs(): string[] {
  return process.argv.slice(2);
}

function showHelp(): void {
  console.log(`Hera Agent Factory CLI

Usage: hera <command> [options]

Commands:
  list agents     List all registered agents
  list skills     List all skills
  list teams      List all teams
  status          Show system status
  version         Show version
  --help          Show this help
`);
}

function listAgents(): void {
  try {
    const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"));
    if (files.length === 0) {
      console.log("No agents found.");
      return;
    }
    console.log("Agents:");
    for (const file of files) {
      const name = file.replace(".md", "");
      const content = readFileSync(resolve(AGENTS_DIR, file), "utf-8");
      const modeMatch = content.match(/mode:\s*(\w+)/);
      const descMatch = content.match(/description:\s*"([^"]+)"/);
      const mode = modeMatch ? modeMatch[1] : "unknown";
      const desc = descMatch ? descMatch[1] : "";
      console.log(`  ${name.padEnd(20)} ${mode.padEnd(12)} ${desc}`);
    }
  } catch {
    console.log("No agents found.");
  }
}

function listSkills(): void {
  try {
    const skillsDir = resolve(HERA_DIR, "skills");
    const files = readdirSync(skillsDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      console.log("No skills found.");
      return;
    }
    console.log("Skills:");
    for (const file of files) {
      const name = file.replace(".json", "");
      console.log(`  ${name}`);
    }
  } catch {
    console.log("No skills found.");
  }
}

function listTeams(): void {
  try {
    const teamsDir = resolve(HERA_DIR, "teams");
    const files = readdirSync(teamsDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      console.log("No teams found.");
      return;
    }
    console.log("Teams:");
    for (const file of files) {
      const name = file.replace(".json", "");
      console.log(`  ${name}`);
    }
  } catch {
    console.log("No teams found.");
  }
}

function showStatus(): void {
  let agents = 0, skills = 0, teams = 0;
  try { agents = readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md")).length; } catch {}
  try { skills = readdirSync(resolve(HERA_DIR, "skills")).filter(f => f.endsWith(".json")).length; } catch {}
  try { teams = readdirSync(resolve(HERA_DIR, "teams")).filter(f => f.endsWith(".json")).length; } catch {}
  console.log(`Hera Status:
  Agents: ${agents}
  Skills: ${skills}
  Teams:  ${teams}`);
}

function showVersion(): void {
  console.log("hera-agent v2.1.0");
}

function main(): void {
  const args = getArgs();
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }
  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    showVersion();
    return;
  }
  if (args[0] === "status") {
    showStatus();
    return;
  }
  if (args[0] === "list" && args[1] === "agents") {
    listAgents();
    return;
  }
  if (args[0] === "list" && args[1] === "skills") {
    listSkills();
    return;
  }
  if (args[0] === "list" && args[1] === "teams") {
    listTeams();
    return;
  }
  console.log(`Unknown command: ${args.join(" ")}`);
  showHelp();
  process.exit(1);
}

main();
