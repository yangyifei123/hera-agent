#!/usr/bin/env node
// Hera CLI binary - for install/uninstall management

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "install":
    console.log("Hera agent installed. Add 'hera-agent' to your opencode.json plugin array.");
    break;
  case "uninstall":
    console.log("Hera agent uninstalled. Remove 'hera-agent' from your opencode.json plugin array.");
    break;
  case "version":
    console.log("hera-agent v1.0.0");
    break;
  case "help":
  default:
    console.log(`
Hera — Agent Factory for OpenCode

Commands:
  install    Show installation instructions
  uninstall  Show uninstall instructions
  version    Show version
  help       Show this help

Usage in opencode.json:
  { "plugin": ["hera-agent"] }

Then run: opencode --agent hera
`);
    break;
}
