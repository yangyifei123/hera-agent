import { tool } from "@opencode-ai/plugin";
import type { PluginContext, AgentDefinition } from "../types.js";
import { DEFAULT_CHILD_MAX_STEPS } from "../constants.js";
import { getDefaultSkills } from "../helpers.js";
import { persistAgent } from "../persistence.js";
import { validateAgentNameWithConflict } from "../validation.js";
import { SkillAnalyzer, SkillDecomposer, CapabilityMapper } from "../skills/analyzer.js";
import { upgradeSkillsToTeam } from "./skill-to-team.js";

const z = tool.schema;

export function createSkillTools(ctx: PluginContext) {
  const { skillManager, store, agentRegistry, registeredAgents, teamManager } = ctx;

  return {
    hera_create_skill: tool({
      description: "Create a reusable skill. Skills define behavior patterns embeddable in agents.",
      args: {
        name: z.string().describe("Skill name"),
        description: z.string().describe("What it does"),
        trigger: z.string().describe("When to activate"),
        prompt: z.string().describe("Instruction prompt"),
      },
      async execute(args) {
        await skillManager.createSkill({
          name: args.name,
          description: args.description,
          trigger: args.trigger,
          prompt: args.prompt,
          category: "user",
        });
        return `Skill "${args.name}" created and persisted.`;
      },
    }),

    hera_list_skills: tool({
      description: "List all skills (builtin + user-created).",
      args: {},
      async execute() {
        const skills = skillManager.getAllSkills();
        return skills.map((s) => `- **${s.name}** (${s.category}): ${s.description}`).join("\n");
      },
    }),

    hera_delete_skill: tool({
      description: "Delete a user-created skill. Built-in skills cannot be removed.",
      args: { name: z.string().describe("Skill name") },
      async execute(args) {
        const ok = await skillManager.deleteSkill(args.name);
        return ok
          ? `Skill "${args.name}" deleted.`
          : `Cannot delete "${args.name}". Built-in skills (caveman, init, skill-combo, memory, evolution) cannot be deleted. Create a custom skill with hera_create_skill instead.`;
      },
    }),

    hera_analyze_skill: tool({
      description:
        "Analyze a skill to understand its capabilities, complexity, and get recommendations for agent conversion.",
      args: {
        skill_name: z.string().describe("Name of the skill to analyze"),
      },
      async execute(args) {
        const skill = skillManager.getSkill(args.skill_name);
        if (!skill) {
          return `Error: Skill "${args.skill_name}" not found. Use hera_list_skills to see available skills.`;
        }

        const analysis = SkillAnalyzer.analyze(skill);

        const lines: string[] = [
          `## Analysis: ${analysis.skillName}`,
          ``,
          `**Complexity:** ${analysis.complexity}`,
          `**Prompt Length:** ${analysis.promptLength} chars`,
          `**Multiple Concerns:** ${analysis.hasMultipleConcerns ? "Yes" : "No"}`,
          `**Suggested Mode:** ${analysis.suggestedMode}`,
          `**Suggested Max Steps:** ${analysis.suggestedMaxSteps}`,
          ``,
        ];

        if (analysis.capabilities.length > 0) {
          lines.push("### Capabilities");
          for (const cap of analysis.capabilities) {
            lines.push(
              `- **${cap.name}** (confidence: ${(cap.confidence * 100).toFixed(0)}%) — evidence: ${cap.evidence}`
            );
          }
          lines.push("");
        }

        lines.push("### Recommendations");
        for (const rec of analysis.recommendations) {
          lines.push(`- ${rec}`);
        }

        return lines.join("\n");
      },
    }),

    hera_decompose_skill: tool({
      description:
        "Decompose a complex skill into smaller, atomic sub-skills. Useful before upgrading to agent.",
      args: {
        skill_name: z.string().describe("Name of the skill to decompose"),
      },
      async execute(args) {
        const skill = skillManager.getSkill(args.skill_name);
        if (!skill) {
          return `Error: Skill "${args.skill_name}" not found. Use hera_list_skills to see available skills.`;
        }

        const subSkills = SkillDecomposer.decompose(skill);

        if (subSkills.length === 1) {
          return `Skill "${args.skill_name}" is already atomic (single capability). No decomposition needed.\n\nName: ${subSkills[0].name}\nDescription: ${subSkills[0].description}`;
        }

        const lines: string[] = [
          `## Decomposition: ${args.skill_name}`,
          ``,
          `Decomposed into ${subSkills.length} atomic sub-skills:`,
          ``,
        ];

        for (const sub of subSkills) {
          lines.push(`### ${sub.name}`);
          lines.push(`- **Description:** ${sub.description}`);
          lines.push(`- **Trigger:** ${sub.trigger}`);
          lines.push(`- **Prompt length:** ${sub.prompt.length} chars`);
          lines.push("");
        }

        lines.push(
          "Use `hera_create_skill` to persist each sub-skill, then `hera_upgrade_to_agent` to create agents."
        );
        return lines.join("\n");
      },
    }),

    hera_upgrade_to_agent: tool({
      description:
        "Upgrade one or more skills into a full agent. Analyzes skill capabilities to suggest optimal agent configuration.",
      args: {
        agent_name: z.string().describe("Name for the new agent"),
        description: z.string().describe("Agent description"),
        skill_names: z.array(z.string()).describe("Skills to upgrade"),
        mode: z
          .enum(["primary", "subagent", "all"])
          .optional()
          .describe("Agent mode (auto-detected if omitted)"),
        model: z.string().optional().describe("Model override"),
      },
      async execute(args) {
        // Validate agent name
        const validation = validateAgentNameWithConflict(args.agent_name, registeredAgents);
        if (!validation.valid) {
          let msg = `Error: ${validation.error}`;
          if (validation.suggestion) msg += ` Suggestion: "${validation.suggestion}".`;
          return msg;
        }

        // --- Skill Analysis Phase (additive, not blocking) ---
        const analysisLines: string[] = [];
        let detectedMode: string | undefined;
        let detectedMaxSteps: number | undefined;
        let detectedTools: Record<string, boolean> | undefined;

        const validSkills: string[] = [];
        for (const skillName of args.skill_names) {
          const skill = skillManager.getSkill(skillName);
          if (!skill) {
            analysisLines.push(`Warning: Skill "${skillName}" not found. Skipping.`);
            continue;
          }
          validSkills.push(skillName);

          const analysis = SkillAnalyzer.analyze(skill);

          analysisLines.push(`--- Analysis: ${skill.name} ---`);
          analysisLines.push(`  Complexity: ${analysis.complexity}`);
          analysisLines.push(
            `  Capabilities: ${analysis.capabilities.map((c) => `${c.name} (${(c.confidence * 100).toFixed(0)}%)`).join(", ") || "none"}`
          );
          analysisLines.push(`  Recommendations: ${analysis.recommendations.join("; ")}`);

          // Use CapabilityMapper for agent configuration suggestions
          if (analysis.capabilities.length > 0) {
            const mapping = CapabilityMapper.mapToAgentCapabilities(
              analysis.capabilities,
              analysis.complexity
            );
            if (!detectedMode) detectedMode = mapping.mode;
            if (!detectedMaxSteps || mapping.maxSteps > detectedMaxSteps) {
              detectedMaxSteps = mapping.maxSteps;
            }
            if (!detectedTools) detectedTools = mapping.tools;
            else {
              // Merge tools: enable if any skill needs it
              for (const [k, v] of Object.entries(mapping.tools)) {
                if (v) detectedTools[k] = true;
              }
            }
          }

          // Suggest decomposition for complex skills
          if (analysis.complexity === "complex") {
            analysisLines.push(
              `  Note: Skill is complex. Consider running hera_decompose_skill first.`
            );
          }
        }

        if (validSkills.length === 0) {
          return `Error: None of the specified skills [${args.skill_names.join(", ")}] were found. Use hera_list_skills to see available skills.`;
        }

        // --- Agent Generation Phase ---
        const agentPrompt = skillManager.upgradeSkillsToAgentPrompt(
          args.agent_name,
          validSkills,
          args.description
        );
        const mode = ((args.mode ?? detectedMode) as AgentDefinition["mode"]) ?? "all";
        const maxSteps = detectedMaxSteps ?? DEFAULT_CHILD_MAX_STEPS;

        const agentDef: AgentDefinition = {
          name: args.agent_name,
          description: args.description,
          mode,
          prompt: agentPrompt,
          model: args.model,
          skills: getDefaultSkills(validSkills),
          tools: detectedTools,
          maxSteps,
          createdAt: Date.now(),
          evolutionLog: [],
        };
        const skillsMap = skillManager.getSkillMap();
        const { fileWritten } = await persistAgent(
          agentDef,
          skillsMap,
          registeredAgents,
          agentRegistry,
          store
        );

        // --- Build response with analysis + result ---
        const resultLines: string[] = [];

        if (analysisLines.length > 0) {
          resultLines.push("## Skill Analysis");
          resultLines.push("");
          resultLines.push(...analysisLines);
          resultLines.push("");
          if (detectedMode && !args.mode) {
            resultLines.push(`Auto-detected mode: ${detectedMode}`);
          }
          if (detectedMaxSteps) {
            resultLines.push(`Auto-calculated max steps: ${detectedMaxSteps}`);
          }
          resultLines.push("");
        }

        resultLines.push(
          `Skills [${validSkills.join(", ")}] upgraded to agent "${args.agent_name}" (${mode}). Persisted to ${fileWritten}.`
        );

        return resultLines.join("\n");
      },
    }),

    hera_upgrade_to_team: tool({
      description:
        "Upgrade multiple skills into a coordinated team — each skill becomes its own member agent, and a team is created with the chosen coordination mode. Use this when skills are better kept separate (specialists) rather than merged into one agent.",
      args: {
        team_name: z.string().describe("Name for the new team"),
        description: z.string().describe("Team purpose"),
        skill_names: z
          .array(z.string())
          .describe("Skills to upgrade — each becomes one member agent"),
        coordination: z
          .enum(["parallel", "sequential", "adaptive"])
          .describe("How the team coordinates"),
        management: z
          .enum(["simple", "okr", "tree", "control"])
          .optional()
          .describe("Management style (default: simple)"),
        member_mode: z
          .enum(["primary", "subagent", "all"])
          .optional()
          .describe("Agent mode for every member (default: subagent)"),
      },
      async execute(args) {
        const result = await upgradeSkillsToTeam({
          skillNames: args.skill_names,
          teamName: args.team_name,
          description: args.description,
          coordination: args.coordination,
          management: args.management,
          memberMode: args.member_mode,
          skillManager,
          teamManager,
          agentRegistry,
          store,
          registeredAgents,
        });

        if (!result.ok) {
          return `Error: ${result.error ?? "Failed to upgrade skills to team."}`;
        }

        return [
          `Team "${args.team_name}" created with ${result.createdAgents.length} member agents (${args.coordination}).`,
          `Members: ${result.createdAgents.join(", ")}.`,
          ``,
          `Each member is now available via @${result.createdAgents[0]} (etc.) or in the team via hera_spawn_team team_name="${args.team_name}".`,
          `To export the team as a plugin: hera_export_team team_name="${args.team_name}" auto_install=true.`,
        ].join("\n");
      },
    }),
  };
}
