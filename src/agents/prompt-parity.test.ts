import { describe, expect, it } from "bun:test";
import { buildAgentPrompt } from "./hera.js";
import { buildSkillManifestSection } from "../skills/manager.js";
import type { AgentDefinition, SkillDefinition } from "../types.js";

const skills: SkillDefinition[] = [
  {
    name: "caveman",
    description: "Ultra-compressed output",
    prompt: "FULL CAVEMAN BODY",
    category: "builtin",
  } as SkillDefinition,
  {
    name: "custom-x",
    description: "Does X",
    prompt: "FULL X BODY",
    category: "user",
  } as SkillDefinition,
];

const def: AgentDefinition = {
  name: "parity-agent",
  description: "d",
  mode: "subagent",
  prompt: "You are parity-agent.",
  skills: ["caveman", "custom-x"],
};

describe("buildAgentPrompt (progressive)", () => {
  it("embeds the manifest, never full skill bodies", () => {
    const out = buildAgentPrompt(def, skills);
    expect(out).toContain("- caveman: Ultra-compressed output");
    expect(out).toContain("- custom-x: Does X");
    expect(out).not.toContain("FULL CAVEMAN BODY");
    expect(out).not.toContain("FULL X BODY");
    expect(out).not.toContain("## Built-in Skill:");
  });

  it("renders the IDENTICAL manifest section as the live config-hook path (§4 pinned)", () => {
    const section = buildSkillManifestSection(
      skills.map((s) => ({ name: s.name, description: s.description }))
    );
    expect(buildAgentPrompt(def, skills)).toContain(section);
  });

  it("parameterizes the loader for exports", () => {
    const out = buildAgentPrompt(def, skills, { loaderToolName: "greek_load_skill" });
    expect(out).toContain("greek_load_skill");
    expect(out).not.toContain("hera_load_skill");
  });

  it("keeps the evolution block", () => {
    const withEvo = {
      ...def,
      evolutionLog: [
        {
          timestamp: 1700000000000,
          trigger: "t",
          observation: "o",
          directive: "Always test",
          rolledBack: false,
        },
      ],
    };
    expect(buildAgentPrompt(withEvo, skills)).toContain("Always test");
  });
});
