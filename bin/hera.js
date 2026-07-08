#!/usr/bin/env node
// hera — CLI for Hera Agent Factory

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const cmd = args[0] || "help";
const flags = new Set(args.slice(1));

// Read version from package.json so CLI never drifts from npm metadata.
function getVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, "..", "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}
const VERSION = getVersion();

const DEFAULT_SKILLS = [
  "caveman",
  "init",
  "memory",
  "evolution",
  "skill-combo",
  "subagent",
  "communicate",
  "auto-compact",
  "workflow-orchestration",
  "brainstorming",
  "skill-creator",
];

const TEMPLATES = {
  general: {
    mode: "all",
    description: "Versatile assistant for any task",
    prompt: (name) => `You are ${name}, a versatile AI assistant. Be concise, accurate, and helpful.`,
  },
  coder: {
    mode: "all",
    description: "Specialized in writing, debugging, and refactoring code",
    prompt: (name) => `You are ${name}, a senior software engineer. Write clean, tested, maintainable code. Always verify changes before reporting done.`,
  },
  reviewer: {
    mode: "subagent",
    description: "Reviews code for quality, security, and maintainability",
    prompt: (name) => `You are ${name}, a code review specialist. Focus on security, performance, maintainability, and correctness.`,
  },
  researcher: {
    mode: "subagent",
    description: "Researches solutions, libraries, patterns, and technical topics",
    prompt: (name) => `You are ${name}, a research analyst. Investigate thoroughly and provide clear recommendations.`,
  },
  coordinator: {
    mode: "all",
    description: "Coordinates agent teams, distributes tasks, aggregates results",
    prompt: (name) => `You are ${name}, a team coordinator. Break complex work into subtasks and synthesize results.`,
  },
  architect: {
    mode: "all",
    description: "Designs system architecture and makes technical decisions",
    prompt: (name) => `You are ${name}, a system architect. Design maintainable systems and document tradeoffs.`,
  },
  debugger: {
    mode: "all",
    description: "Investigates bugs, traces issues, proposes fixes",
    prompt: (name) => `You are ${name}, a debugging specialist. Reproduce, isolate, fix, and explain root causes.`,
  },
  tester: {
    mode: "subagent",
    description: "Writes tests, ensures quality, finds edge cases",
    prompt: (name) => `You are ${name}, a test engineer. Write reliable tests and find edge cases.`,
  },
  documenter: {
    mode: "subagent",
    description: "Creates clear, comprehensive documentation",
    prompt: (name) => `You are ${name}, a documentation specialist. Write clear docs with examples and edge cases.`,
  },
  optimizer: {
    mode: "subagent",
    description: "Optimizes code for speed, memory, and efficiency",
    prompt: (name) => `You are ${name}, a performance optimizer. Profile first, optimize second, and measure impact.`,
  },
};

function getConfigRoot() {
  // Keep this logic in sync with src/constants.ts resolveOpenCodeConfigRoot().
  // Precedence: HERA_CONFIG_ROOT (canonical) > OPENCODE_CONFIG_ROOT (legacy alias) > default.
  if (process.env.HERA_CONFIG_ROOT) return process.env.HERA_CONFIG_ROOT;
  if (process.env.OPENCODE_CONFIG_ROOT) return process.env.OPENCODE_CONFIG_ROOT;
  if (process.platform === "win32") {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
    return path.join(home, ".config", "opencode");
  }
  const home = process.env.HOME ?? homedir();
  return path.join(home, ".config", "opencode");
}

function getFlag(name, fallback = undefined) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }
  return fallback;
}

function validateAgentName(name) {
  if (!name) return { ok: false, error: "Agent name is required." };
  if (name.length > 50) return { ok: false, error: "Agent name must be 50 characters or less." };
  if (!["hera", "opencode", "system"].includes(name) && /^[a-z][a-z0-9-]*$/.test(name) && !name.endsWith("-")) {
    return { ok: true };
  }
  if (["hera", "opencode", "system"].includes(name)) {
    return { ok: false, error: `"${name}" is a reserved name.` };
  }
  const suggestion = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([0-9])/, "agent-$1");
  return {
    ok: false,
    error: "Agent name must start with a letter and contain only lowercase letters, numbers, and hyphens.",
    suggestion: suggestion || "agent",
  };
}

function escapeFrontmatter(value) {
  return String(value).replace(/"/g, '\\"');
}

function jsonFrontmatter(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildAgentMarkdown(def) {
  return [
    "---",
    `name: ${def.name}`,
    `description: "${escapeFrontmatter(def.description)}"`,
    `mode: ${def.mode}`,
    def.model ? `model: ${def.model}` : "",
    `maxSteps: ${def.maxSteps}`,
    def.template ? `template: ${def.template}` : "",
    `createdAt: ${def.createdAt}`,
    `skillsJson: ${jsonFrontmatter(def.skills)}`,
    "---",
    "",
    `# Agent: ${def.name}`,
    "",
    def.prompt,
    "",
    "## Built-in Skills",
    "",
    `This agent inherits: ${def.skills.join(", ")}.`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function ensureRuntimeDirs(configRoot) {
  for (const dir of [
    path.join(configRoot, "agents", "hera"),
    path.join(configRoot, "hera-data", "memory", "agents"),
    path.join(configRoot, "hera-data", "memory", "teams"),
    path.join(configRoot, "hera-data", "skills"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createAgentFromCli(name) {
  const configRoot = getConfigRoot();
  ensureRuntimeDirs(configRoot);
  const agentsDir = path.join(configRoot, "agents", "hera");
  const filePath = path.join(agentsDir, `${name}.md`);
  const validation = validateAgentName(name);
  if (!validation.ok) {
    console.log(`[✗] ${validation.error}${validation.suggestion ? ` Suggestion: ${validation.suggestion}` : ""}`);
    process.exit(1);
  }
  if (fs.existsSync(filePath)) {
    console.log(`[✗] Agent "${name}" already exists at ${filePath}`);
    process.exit(1);
  }
  const templateName = getFlag("--template", "general");
  const template = TEMPLATES[templateName];
  if (!template) {
    console.log(`[✗] Unknown template "${templateName}". Run: hera list-templates`);
    process.exit(1);
  }
  const mode = getFlag("--mode", template.mode);
  if (!["primary", "subagent", "all"].includes(mode)) {
    console.log(`[✗] Invalid mode "${mode}". Use: all, primary, or subagent.`);
    process.exit(1);
  }
  const prompt = getFlag("--prompt", template.prompt(name));
  const description = getFlag("--description", template.description);
  const maxSteps = Number(getFlag("--max-steps", "30"));
  const model = getFlag("--model", "");
  const def = {
    name,
    description,
    mode,
    prompt,
    model: model || undefined,
    skills: DEFAULT_SKILLS,
    maxSteps: Number.isFinite(maxSteps) ? maxSteps : 30,
    template: templateName,
    createdAt: Date.now(),
    evolutionLog: [],
  };
  fs.writeFileSync(filePath, buildAgentMarkdown(def), "utf-8");
  const memoryPath = path.join(configRoot, "hera-data", "memory", "agents", `agent-${name}.json`);
  fs.writeFileSync(
    memoryPath,
    JSON.stringify(
      {
        id: `agent-${name}`,
        type: "agent",
        content: JSON.stringify(def),
        timestamp: Date.now(),
        metadata: { mode, skills: def.skills, fileWritten: filePath, source: "hera-cli" },
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  console.log(`Agent "${name}" created.`);
  console.log(`Mode: ${mode}. Template: ${templateName}.`);
  console.log(`Persisted to: ${filePath}`);
  console.log(`Use it with: opencode --agent ${name} "your task"`);
}

function createProgramSkillFromCli(name) {
  const configRoot = getConfigRoot();
  ensureRuntimeDirs(configRoot);
  const skillDir = path.join(configRoot, "hera-data", "skills", name);
  if (fs.existsSync(skillDir)) {
    console.log(`[✗] Skill "${name}" already exists at ${skillDir}`);
    process.exit(1);
  }
  fs.mkdirSync(skillDir, { recursive: true });

  const skillJson = {
    name,
    description: getFlag("--description", `Program skill ${name}`),
    trigger: "",
    category: "user",
    program: "run.ts",
  };
  fs.writeFileSync(path.join(skillDir, "SKILL.json"), JSON.stringify(skillJson, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "", "utf-8");

  const runTs = [
    'import type { Hera } from "./hera-sdk";',
    "",
    "export default async function run(hera: Hera, args: unknown) {",
    '  hera.log("program started");',
    "  // Deterministic step:",
    '  const status = await hera.sh("git status --short");',
    "  // Model as a function (uncomment to use):",
    '  // const summary = await hera.llm("Summarize these changes", {',
    "  //   input: status.stdout,",
    '  //   schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },',
    "  // });",
    "  return { ok: true, changed: status.stdout.trim().length > 0 };",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "run.ts"), runTs, "utf-8");

  const heraSdkDts = [
    "// Auto-generated by Hera. The authoring surface for this program skill.",
    "export interface Hera {",
    "  args: unknown;",
    "  log(message: string): void;",
    "  sh(cmd: string, opts?: { cwd?: string; timeoutMs?: number })",
    "    : Promise<{ stdout: string; stderr: string; code: number }>;",
    "  file: {",
    "    read(path: string): Promise<string>;",
    "    write(path: string, content: string): Promise<void>;",
    "    exists(path: string): Promise<boolean>;",
    "    list(dir: string): Promise<string[]>;",
    "  };",
    "  llm(prompt: string, opts?: { input?: unknown; schema?: object; executor?: string }): Promise<unknown>;",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "hera-sdk.d.ts"), heraSdkDts, "utf-8");

  console.log(`Program skill "${name}" scaffolded at ${skillDir}`);
  console.log("Edit run.ts, then run it with the hera_run_program tool.");
}

function printStatus() {
  const configRoot = getConfigRoot();
  const agentsDir = path.join(configRoot, "agents", "hera");
  const skillsDir = path.join(configRoot, "hera-data", "skills");
  const teamsDir = path.join(configRoot, "hera-data", "memory", "teams");
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
  const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  const teams = fs.existsSync(teamsDir) ? fs.readdirSync(teamsDir).filter((f) => f.endsWith(".json")) : [];
  const opencodeJson = path.join(configRoot, "opencode.json");
  let configured = false;
  try {
    configured = JSON.parse(fs.readFileSync(opencodeJson, "utf-8")).plugin?.includes("hera-agent") === true;
  } catch {
    configured = false;
  }
  console.log("Hera Agent Factory — Status\n");
  console.log(`Config root: ${configRoot}`);
  console.log(`OpenCode plugin configured: ${configured ? "yes" : "no"}`);
  console.log(`Agents: ${agents.length}`);
  console.log(`User skills: ${skills.length}`);
  console.log(`Teams: ${teams.length}`);
  console.log(`CLI: v${VERSION}`);
}

function runQuickstart() {
  const name = getFlag("--name", "my-coder");
  const configRoot = getConfigRoot();
  const filePath = path.join(configRoot, "agents", "hera", `${name}.md`);
  console.log("Hera Agent Factory — Quickstart\n");
  if (!fs.existsSync(filePath)) {
    createAgentFromCli(name);
    console.log("");
  } else {
    console.log(`[i] Agent "${name}" already exists at ${filePath}`);
  }
  console.log("Next steps:");
  console.log(`  1. opencode --agent ${name} "review src/index.ts"`);
  console.log(`  2. opencode run --agent hera "remember: our project uses strict TypeScript"`);
  console.log(`  3. opencode run --agent hera "create review-team with ${name} and bug-hunter, mode: parallel"`);
}

function checkBun() {
  try {
    const version = execSync("bun --version", { encoding: "utf8", stdio: "pipe" }).trim();
    return version;
  } catch {
    return null;
  }
}

function checkNpm() {
  try {
    const version = execSync("npm --version", { encoding: "utf8", stdio: "pipe" }).trim();
    return version;
  } catch {
    return null;
  }
}

function runCmd(command, options = {}) {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: "pipe", ...options });
    return { ok: true, output: result.trim() };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function checkOpenCode() {
  try {
    const version = execSync("opencode --version", { encoding: "utf8", stdio: "pipe" }).trim();
    return version || "installed";
  } catch {
    return null;
  }
}

function quotePath(p) {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function shellPaths(configRoot = getConfigRoot()) {
  const npmRoot = process.platform === "win32" ? quotePath(configRoot) : "~/.config/opencode";
  const cdRoot = process.platform === "win32" ? `cd ${quotePath(configRoot)}` : "cd ~/.config/opencode";
  const cliPath =
    process.platform === "win32"
      ? `node ${quotePath(path.join(configRoot, "node_modules", "hera-agent", "bin", "hera.js"))}`
      : "node ~/.config/opencode/node_modules/hera-agent/bin/hera.js";
  const removeData =
    process.platform === "win32"
      ? [
          `Remove-Item -Recurse -Force ${quotePath(path.join(configRoot, "hera-data"))}`,
          `Remove-Item -Recurse -Force ${quotePath(path.join(configRoot, "agents", "hera"))}`,
          `Remove-Item -Force ${quotePath(path.join(configRoot, "hera.json"))}`,
        ]
      : [
          "rm -rf ~/.config/opencode/hera-data/",
          "rm -rf ~/.config/opencode/agents/hera/",
          "rm -f ~/.config/opencode/hera.json",
        ];
  return { npmRoot, cdRoot, removeData, cliPath };
}

function hasPurgeConfirmation() {
  return flags.has("--yes") || process.env.HERA_CONFIRM_PURGE === "1";
}

function removePluginRegistration(configRoot) {
  const opencodeJson = path.join(configRoot, "opencode.json");
  if (!fs.existsSync(opencodeJson)) return { ok: true, changed: false };
  try {
    const content = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
    const plugins = Array.isArray(content.plugin) ? content.plugin : [];
    const nextPlugins = plugins.filter((plugin) => plugin !== "hera-agent");
    if (nextPlugins.length === plugins.length) return { ok: true, changed: false };
    content.plugin = nextPlugins;
    fs.writeFileSync(opencodeJson, JSON.stringify(content, null, 2) + "\n");
    return { ok: true, changed: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

switch (cmd) {
  case "version":
  case "-v":
    console.log(`hera-agent v${VERSION}`);
    break;

  case "install": {
    console.log("Hera Agent Factory — Installing...\n");

    // 1. Pick a package manager. Prefer npm because Bun is optional for published installs.
    const npmVersion = checkNpm();
    const bunVersion = checkBun();
    if (npmVersion) {
      console.log(`[✓] npm v${npmVersion}`);
    } else if (bunVersion) {
      console.log(`[✓] bun v${bunVersion}`);
    } else {
      console.log("[✗] Neither npm nor bun is installed.\n");
      console.log("Install Node.js LTS first, then retry:");
      console.log("  Linux:    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs");
      console.log("  macOS:    brew install node");
      console.log("  Windows:  https://nodejs.org/\n");
      process.exit(1);
    }

    // 2. Compute config root
    const configRoot = getConfigRoot();
    console.log(`[i] Config root: ${configRoot}`);

    // 3. Create config root if not exists
    if (!fs.existsSync(configRoot)) {
      try {
        fs.mkdirSync(configRoot, { recursive: true });
        console.log(`[✓] Created config directory`);
      } catch (err) {
        console.log(`[✗] Failed to create config directory: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.log(`[✓] Config directory exists`);
    }

    // 4. Check for opencode.json
    const opencodeJson = path.join(configRoot, "opencode.json");
    let needsOpencodeJsonUpdate = false;
    if (fs.existsSync(opencodeJson)) {
      try {
        const content = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
        const plugins = content.plugin || [];
        if (plugins.includes("hera-agent")) {
          console.log("[✓] opencode.json already has hera-agent in plugin array");
        } else {
          needsOpencodeJsonUpdate = true;
        }
      } catch {
        needsOpencodeJsonUpdate = true;
      }
    } else {
      needsOpencodeJsonUpdate = true;
    }

    // 5. Install package. npm is preferred because it avoids Bun install issues.
    const useNpm = Boolean(npmVersion);
    console.log(`\n[i] Installing hera-agent via ${useNpm ? "npm" : "bun"}...`);
    let addCmd;
    if (process.platform === "win32") {
      addCmd = useNpm ? `cmd /c npm install hera-agent` : `cmd /c bun add hera-agent`;
    } else {
      addCmd = useNpm ? `npm install hera-agent` : `bun add hera-agent`;
    }
    const installResult = runCmd(addCmd, { cwd: configRoot });
    if (!installResult.ok) {
      console.log(`[✗] Failed to install: ${installResult.error}`);
      console.log("    Manual fallback: npm pack hera-agent, copy the .tgz, then npm install /path/to/hera-agent-<version>.tgz");
      process.exit(1);
    }
    console.log(`[✓] hera-agent installed via ${useNpm ? "npm" : "bun"}`);

    // 6. Update opencode.json if needed
    if (needsOpencodeJsonUpdate) {
      try {
        let content = {};
        if (fs.existsSync(opencodeJson)) {
          content = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
        }
        if (!content.plugin) content.plugin = [];
        if (!content.plugin.includes("hera-agent")) {
          content.plugin.push("hera-agent");
        }
        fs.writeFileSync(opencodeJson, JSON.stringify(content, null, 2) + "\n");
        console.log("[✓] opencode.json updated with hera-agent plugin");
      } catch (err) {
        console.log(`[!] Warning: Could not update opencode.json: ${err.message}`);
        console.log("    Please manually add \"hera-agent\" to the plugin array in opencode.json");
      }
    }

    console.log("\n[✓] Installation complete!");
    console.log("    Start Hera with: opencode --agent hera");
    break;
  }

  case "create": {
    if (args[1] === "skill" && args[2]) {
      if (!flags.has("--program")) {
        console.log("Usage: hera create skill NAME --program");
        process.exit(1);
      }
      createProgramSkillFromCli(args[2]);
      break;
    }
    if (args[1] !== "agent" || !args[2]) {
      console.log("Usage: hera create agent NAME --template coder --mode all");
      console.log("       hera create skill NAME --program");
      process.exit(1);
    }
    createAgentFromCli(args[2]);
    break;
  }

  case "quickstart":
  case "init": {
    runQuickstart();
    break;
  }

  case "status": {
    printStatus();
    break;
  }

  case "doctor": {
    console.log("Hera Agent Factory — Health Check\n");
    let pass = 0;
    let fail = 0;

    // 1. Check package manager. Bun is optional; npm is enough for published installs.
    const npmVersion = checkNpm();
    const bunVersion = checkBun();
    if (npmVersion) {
      console.log(`[✓] npm installed (v${npmVersion})`);
      pass++;
    } else if (bunVersion) {
      console.log(`[✓] bun installed (v${bunVersion})`);
      pass++;
    } else {
      console.log("[✗] neither npm nor bun is installed");
      fail++;
    }

    const opencodeVersion = checkOpenCode();
    if (opencodeVersion) {
      console.log(`[✓] opencode CLI installed (${opencodeVersion})`);
      pass++;
    } else {
      console.log(
        "[✗] opencode CLI not found in PATH — install OpenCode before using Hera: https://github.com/opencode-ai/opencode"
      );
      fail++;
    }

    // 2. Check opencode.json has hera-agent
    const configRoot = getConfigRoot();
    const opencodeJson = path.join(configRoot, "opencode.json");
    if (fs.existsSync(opencodeJson)) {
      try {
        const content = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
        const plugins = content.plugin || [];
        if (plugins.includes("hera-agent")) {
          console.log("[✓] opencode.json configured with hera-agent");
          pass++;
        } else {
          console.log("[✗] opencode.json exists but hera-agent not in plugin array");
          fail++;
        }
      } catch {
        console.log("[✗] opencode.json exists but is not valid JSON");
        fail++;
      }
    } else {
      console.log(`[✗] opencode.json not found at ${opencodeJson}`);
      fail++;
    }

    // 3. Check dist/index.js in node_modules
    const distPath = path.join(configRoot, "node_modules", "hera-agent", "dist", "index.js");
    if (fs.existsSync(distPath)) {
      console.log("[✓] hera-agent dist files present");
      pass++;
    } else {
      console.log(`[✗] hera-agent dist/index.js not found at ${distPath}`);
      console.log("    Run: hera install");
      fail++;
    }

    // 4. Check hera-data directory
    const heraDataDir = path.join(configRoot, "hera-data");
    if (fs.existsSync(heraDataDir)) {
      console.log("[✓] hera-data/ directory exists");
      pass++;
    } else {
      console.log("[!] hera-data/ not found — will be created on first load");
    }

    // 5. Check agents/hera directory
    const agentsDir = path.join(configRoot, "agents", "hera");
    if (fs.existsSync(agentsDir)) {
      const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
      console.log(`[✓] agents/hera/ directory exists (${files.length} agent files)`);
      pass++;
    } else {
      console.log("[!] agents/hera/ not found — will be created on first load");
    }

    // Summary
    console.log(`\n--- Result: ${pass} passed, ${fail} failed ---`);
    if (fail === 0) {
      console.log("All checks passed. Hera is healthy.");
    } else {
      const paths = shellPaths(configRoot);
      console.log(
        `Some checks failed. Install with npm first: npm install --prefix ${paths.npmRoot} hera-agent`
      );
      console.log(`Then verify with: ${paths.cliPath} doctor`);
    }
    process.exit(fail > 0 ? 1 : 0);
    break;
  }

  case "update":
  case "upgrade": {
    const configRoot = getConfigRoot();
    const paths = shellPaths(configRoot);
    if (flags.has("--run")) {
      console.log("Hera Agent Factory — Updating via npm...\n");
      const result = runCmd(`npm update --prefix ${quotePath(configRoot)} hera-agent`);
      if (!result.ok) {
        console.log(`[✗] Update failed: ${result.error}`);
        process.exit(1);
      }
      console.log("[✓] hera-agent updated via npm");
      console.log("    Restart OpenCode, then run: hera doctor");
      break;
    }
    console.log(`
Hera Agent Factory — Update

Run automatically:
  hera update --run

Update from npm:
  npm update --prefix ${paths.npmRoot} hera-agent

Or force reinstall latest:
  npm uninstall --prefix ${paths.npmRoot} hera-agent
  npm install --prefix ${paths.npmRoot} hera-agent@latest

Install a specific version or rollback:
  npm install --prefix ${paths.npmRoot} hera-agent@${VERSION}

If you installed with Bun:
  ${paths.cdRoot}
  bun update hera-agent

Update from local source:
  1. cd /path/to/hera-agent
  2. git pull origin master (if from git)
  3. npm install && npm run build
  4. npm install --prefix ${paths.npmRoot} /path/to/hera-agent

Check current version:
  hera version

Check latest version:
  npm view hera-agent version

After update:
  1. Restart OpenCode
  2. Verify: opencode --agent hera
  3. Check: hera version
`);
    break;
  }

  case "uninstall": {
    const configRoot = getConfigRoot();
    const paths = shellPaths(configRoot);
    if (flags.has("--run")) {
      const purge = flags.has("--purge");
      if (purge && !hasPurgeConfirmation()) {
        console.log("[✗] Refusing to purge Hera data without confirmation.");
        console.log("    Re-run with: hera uninstall --run --purge --yes");
        console.log("    Or set HERA_CONFIRM_PURGE=1 for non-interactive automation.");
        process.exit(1);
      }
      console.log(`Hera Agent Factory — Uninstalling${purge ? " (purge)" : " (keep data)"}...\n`);
      const unregister = removePluginRegistration(configRoot);
      if (!unregister.ok) {
        console.log(`[✗] Could not update opencode.json: ${unregister.error}`);
        process.exit(1);
      }
      console.log(
        unregister.changed
          ? "[✓] Removed hera-agent from opencode.json"
          : "[i] opencode.json did not need changes"
      );
      const result = runCmd(`npm uninstall --prefix ${quotePath(configRoot)} hera-agent`);
      if (!result.ok) {
        console.log(`[✗] npm uninstall failed: ${result.error}`);
        process.exit(1);
      }
      console.log("[✓] hera-agent package removed via npm");
      if (purge) {
        for (const target of [
          path.join(configRoot, "hera-data"),
          path.join(configRoot, "agents", "hera"),
          path.join(configRoot, "hera.json"),
        ]) {
          fs.rmSync(target, { recursive: true, force: true });
        }
        console.log("[✓] Hera data, agents, and hera.json removed");
      } else {
        console.log("[i] Hera data preserved. Reinstall later to restore agents, skills, and memory.");
      }
      break;
    }
    console.log(`
Hera Agent Factory — Uninstall

Run automatically, keeping Hera data:
  hera uninstall --run

Run automatically and remove Hera data:
  hera uninstall --run --purge --yes

Keep Data (reinstall later):
  1. Edit ${path.join(configRoot, "opencode.json")} - remove "hera-agent" from plugin array
  2. npm uninstall --prefix ${paths.npmRoot} hera-agent
  (Your agents, skills, and memory will be preserved)

Complete Uninstall (removes everything):
  1. Edit ${path.join(configRoot, "opencode.json")} - remove "hera-agent" from plugin array
  2. npm uninstall --prefix ${paths.npmRoot} hera-agent
  3. ${paths.removeData[0]}
  4. ${paths.removeData[1]}
  5. ${paths.removeData[2]}

If you installed with Bun, replace npm uninstall with:
  ${paths.cdRoot} && bun remove hera-agent
`);
    break;
  }

  case "list":
  case "list-agents": {
    const configRoot = getConfigRoot();
    const agentsDir = path.join(configRoot, "agents", "hera");
    if (!fs.existsSync(agentsDir)) {
      console.log("No agents directory yet. Run Hera at least once to initialize.");
      break;
    }
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      console.log("No agents created yet.");
      break;
    }
    console.log("Agents:");
    for (const f of files) {
      const name = f.replace(/\.md$/, "");
      const content = fs.readFileSync(path.join(agentsDir, f), "utf8");
      const modeMatch = content.match(/^mode:\s*(\w+)/m);
      const descMatch = content.match(/^description:\s*"([^"]+)"/m);
      const mode = modeMatch ? modeMatch[1] : "?";
      const desc = descMatch ? descMatch[1] : "";
      console.log(`  ${name.padEnd(24)} ${mode.padEnd(10)} ${desc}`);
    }
    break;
  }

  case "list-skills": {
    const builtins = [
      ["caveman", "Ultra-compressed communication"],
      ["init", "Environment awareness"],
      ["memory", "Autonomous memory management"],
      ["evolution", "Self-improvement through reflection"],
      ["skill-combo", "Dynamic skill composition"],
      ["subagent", "Delegate to specialized agents"],
      ["communicate", "Team coordination via messaging"],
      ["auto-compact", "Context window discipline"],
      ["workflow-orchestration", "Multi-step workflow planning"],
      ["brainstorming", "Requirement exploration before implementation"],
      ["skill-creator", "Create and refine reusable skills"],
    ];
    console.log("Built-in skills (always available):");
    for (const [name, desc] of builtins) {
      console.log(`  ${name.padEnd(14)} ${desc}`);
    }
    const userSkillsDir = path.join(getConfigRoot(), "hera-data", "skills");
    if (fs.existsSync(userSkillsDir)) {
      const entries = fs.readdirSync(userSkillsDir);
      if (entries.length > 0) {
        console.log("\nUser skills:");
        for (const e of entries) {
          console.log(`  ${e}`);
        }
      }
    }
    break;
  }

  case "list-templates": {
    const tpls = [
      ["general", "Versatile assistant"],
      ["coder", "Coding expert"],
      ["reviewer", "Code review specialist"],
      ["researcher", "Research analyst"],
      ["coordinator", "Team coordinator"],
      ["architect", "System architect"],
      ["debugger", "Bug fixing specialist"],
      ["tester", "QA engineer"],
      ["documenter", "Documentation writer"],
      ["optimizer", "Performance optimizer"],
    ];
    console.log("Agent templates:");
    for (const [name, desc] of tpls) {
      console.log(`  ${name.padEnd(14)} ${desc}`);
    }
    break;
  }

  case "list-teams": {
    const configRoot = getConfigRoot();
    const memDir = path.join(configRoot, "hera-data", "memory", "teams");
    if (!fs.existsSync(memDir)) {
      console.log("No teams yet.");
      break;
    }
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      console.log("No teams yet.");
      break;
    }
    console.log("Teams:");
    for (const f of files) {
      try {
        const memo = JSON.parse(fs.readFileSync(path.join(memDir, f), "utf8"));
        const team = JSON.parse(memo.content);
        const members = team.members.map((m) => m.agentName).join(", ");
        console.log(`  ${team.name.padEnd(24)} ${team.coordination.padEnd(12)} ${members}`);
      } catch {
        // skip malformed
      }
    }
    break;
  }

  case "help":
  case "--help":
  case "-h": {
    printHelp();
    break;
  }

  default:
    console.error(`[✗] Unknown command "${cmd}". Run 'hera help' for usage.`);
    process.exit(1);
}

function printHelp() {
  console.log(`
Hera Agent Factory v${VERSION}

Commands:
  hera install        Install hera-agent into OpenCode
  hera doctor         Run health checks on Hera installation
  hera quickstart     Create a starter agent and show next steps
  hera create agent NAME --template coder  Create a disk-backed agent
  hera status         Show local Hera counts and config state
  hera update         Show update/upgrade instructions
  hera uninstall      Show uninstall instructions
  hera list           List registered agents (alias: list-agents)
  hera list-skills    List built-in + user skills
  hera list-templates List agent templates
  hera list-teams     List registered teams
  hera version        Show version
  hera help           Show this help

Usage:
  opencode --agent hera              Start Hera agent
  opencode --agent <agent-name>      Start a Hera-created agent
  opencode run --agent hera "..."    Run a single command

Built-in Skills (11):
  caveman       Ultra-compressed communication (~75% token savings)
  init          Environment awareness and project detection
  memory        Autonomous memory management
  evolution     Self-improvement through reflection
  skill-combo   Dynamic skill composition
  subagent      Delegate to specialized agents
  communicate   Team coordination via messaging
  auto-compact  Context window discipline
  workflow-orchestration Multi-step workflow planning
  brainstorming Requirement exploration before implementation
  skill-creator Create and refine reusable skills

Agent Templates (10):
  general, coder, reviewer, researcher, coordinator,
  architect, debugger, tester, documenter, optimizer
`);
}
