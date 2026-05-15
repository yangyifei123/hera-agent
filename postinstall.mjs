// Post-install hook for hera-agent - Cross-platform auto-configuration
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function getConfigRoot() {
  if (process.platform === "win32") {
    return join(process.env.USERPROFILE || "C:/Users/Administrator", ".config", "opencode");
  }
  return join(process.env.HOME || "/root", ".config", "opencode");
}

function ensureDirectories(configRoot) {
  const dirs = [
    join(configRoot, "hera-data"),
    join(configRoot, "hera-data", "memory"),
    join(configRoot, "hera-data", "skills"),
    join(configRoot, "hera-data", "backups"),
    join(configRoot, "agents", "hera"),
  ];

  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`  Created: ${dir}`);
      }
    } catch (err) {
      console.log(`  Warning: Could not create ${dir} - ${err.message}`);
    }
  }
}

function updateOpencodeJson(configRoot) {
  const jsonPath = join(configRoot, "opencode.json");
  let config = {};

  // Read existing config if it exists
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8");
      config = JSON.parse(content);
    } catch (err) {
      console.log(`  Warning: Could not parse ${jsonPath}, will create new file`);
      config = {};
    }
  }

  // Ensure plugin array exists
  if (!config.plugin) {
    config.plugin = [];
  }

  // Add hera-agent if not present
  if (!config.plugin.includes("hera-agent")) {
    config.plugin.push("hera-agent");
    try {
      writeFileSync(jsonPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(`  Updated: ${jsonPath} (added hera-agent to plugins)`);
    } catch (err) {
      console.log(`  Warning: Could not update ${jsonPath} - ${err.message}`);
    }
  } else {
    console.log(`  Already configured: hera-agent in plugins`);
  }
}

function main() {
  console.log("\n🔧 hera-agent post-install configuration\n");

  const configRoot = getConfigRoot();
  const platform = process.platform === "win32" ? "Windows" : "Linux/macOS";

  console.log(`  Platform: ${platform}`);
  console.log(`  Config root: ${configRoot}\n`);

  // Ensure config root exists first
  try {
    if (!existsSync(configRoot)) {
      mkdirSync(configRoot, { recursive: true });
      console.log(`  Created config root: ${configRoot}`);
    }
  } catch (err) {
    console.log(`  Warning: Config root not accessible - ${err.message}`);
    console.log("  Hera will create directories on first load.\n");
    console.log("✅ hera-agent installed successfully.\n");
    return;
  }

  // Create directories
  console.log("  Creating directories...");
  ensureDirectories(configRoot);

  // Update opencode.json
  console.log("\n  Configuring opencode.json...");
  updateOpencodeJson(configRoot);

  console.log("\n✅ hera-agent installed successfully.\n");
  console.log("  Usage: opencode --agent hera");
  console.log("  Or:    opencode run --agent hera \"your command\"\n");
}

main();
