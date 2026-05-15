#!/usr/bin/env node
// hera — CLI for Hera Agent Factory

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] || "help";

function getConfigRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.USERPROFILE || process.env.HOME, ".config", "opencode");
  }
  return path.join(process.env.HOME, ".config", "opencode");
}

function checkBun() {
  try {
    const version = execSync("bun --version", { encoding: "utf8", stdio: "pipe" }).trim();
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

switch (cmd) {
  case "version":
  case "-v":
    console.log("hera-agent v2.0.0");
    break;

  case "install": {
    console.log("Hera Agent Factory — Installing...\n");

    // 1. Check bun
    const bunVersion = checkBun();
    if (!bunVersion) {
      console.log("[✗] Bun is not installed.\n");
      console.log("Install Bun first:");
      console.log("  Windows:  powershell -c \"irm bun.sh/install.ps1 | iex\"");
      console.log("  macOS:    curl -fsSL https://bun.sh/install | bash");
      console.log("  Linux:    curl -fsSL https://bun.sh/install | bash\n");
      process.exit(1);
    }
    console.log(`[✓] bun v${bunVersion}`);

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

    // 5. Run bun add hera-agent
    console.log("\n[i] Installing hera-agent via bun...");
    let addCmd;
    if (process.platform === "win32") {
      addCmd = `cmd /c bun add hera-agent`;
    } else {
      addCmd = `bun add hera-agent`;
    }
    const installResult = runCmd(addCmd, { cwd: configRoot });
    if (!installResult.ok) {
      console.log(`[✗] Failed to install: ${installResult.error}`);
      process.exit(1);
    }
    console.log("[✓] hera-agent installed via bun");

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

  case "doctor": {
    console.log("Hera Agent Factory — Health Check\n");
    let pass = 0;
    let fail = 0;

    // 1. Check bun
    const bunVersion = checkBun();
    if (bunVersion) {
      console.log(`[✓] bun installed (v${bunVersion})`);
      pass++;
    } else {
      console.log("[✗] bun not installed — install from https://bun.sh");
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
      console.log("Some checks failed. Run 'hera install' to fix installation issues.");
    }
    process.exit(fail > 0 ? 1 : 0);
    break;
  }

  case "update":
  case "upgrade":
    console.log(`
Hera Agent Factory — Update

Update from npm:
  cd ~/.config/opencode
  bun update hera-agent

Or force reinstall latest:
  bun remove hera-agent && bun add hera-agent@latest

Update from local source:
  1. cd /path/to/hera-agent
  2. git pull origin master (if from git)
  3. bun install && bun run build
  4. cd ~/.config/opencode
  5. bun remove hera-agent
  6. bun add file:///path/to/hera-agent

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
  hera install     Install hera-agent into OpenCode
  hera doctor      Run health checks on Hera installation
  hera update      Show update/upgrade instructions
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
