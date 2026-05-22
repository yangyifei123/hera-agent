import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SkillManager } from "./manager.js";
import { MemoryStore } from "../memory/store.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import type { SkillPackage, SkillDefinition } from "../types.js";

const TEST_DIR = join(tmpdir(), "hera-skill-manager-test");
const SKILLS_DIR = join(TEST_DIR, "skills");
const MEMORY_DIR = join(TEST_DIR, "memory");

describe("SkillManager", () => {
  let manager: SkillManager;
  let store: MemoryStore;

  beforeEach(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(SKILLS_DIR, { recursive: true });
    mkdirSync(MEMORY_DIR, { recursive: true });

    store = new MemoryStore(MEMORY_DIR);
    await store.init();
    manager = new SkillManager(store, SKILLS_DIR);
    await manager.init();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("SkillPackage support", () => {
    test("createSkill with SkillPackage writes directory structure", async () => {
      const pkg: SkillPackage = {
        name: "test-package",
        description: "A test skill package",
        trigger: "test",
        prompt: "Test prompt content",
        category: "user",
        files: [
          { path: "scripts/run.sh", content: "#!/bin/bash\necho hello" },
          { path: "templates/example.txt", content: "Hello {{name}}" },
        ],
        config: { timeout: 5000 },
      };

      await manager.createSkill(pkg);

      // Verify directory structure
      const skillDir = join(SKILLS_DIR, "test-package");
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.json"))).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "config.json"))).toBe(true);
      expect(existsSync(join(skillDir, "scripts/run.sh"))).toBe(true);
      expect(existsSync(join(skillDir, "templates/example.txt"))).toBe(true);

      // Verify SKILL.json content
      const metadata = JSON.parse(readFileSync(join(skillDir, "SKILL.json"), "utf-8"));
      expect(metadata.name).toBe("test-package");
      expect(metadata.description).toBe("A test skill package");
      expect(metadata.category).toBe("user");

      // Verify SKILL.md content
      const promptContent = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(promptContent).toBe("Test prompt content");

      // Verify config.json content
      const config = JSON.parse(readFileSync(join(skillDir, "config.json"), "utf-8"));
      expect(config.timeout).toBe(5000);

      // Verify additional files
      const script = readFileSync(join(skillDir, "scripts/run.sh"), "utf-8");
      expect(script).toBe("#!/bin/bash\necho hello");
    });

    test("loadSkill reads SkillPackage from disk", async () => {
      // First create the package
      const pkg: SkillPackage = {
        name: "loadable-pkg",
        description: "Loadable package",
        trigger: "load",
        prompt: "Load test prompt",
        category: "user",
        files: [{ path: "references/ref.md", content: "Reference doc" }],
      };
      await manager.createSkill(pkg);

      // Now load it
      const loaded = await manager.loadSkill("loadable-pkg");
      expect(loaded).toBeDefined();
      expect(loaded!.name).toBe("loadable-pkg");
      expect(loaded!.prompt).toBe("Load test prompt");
      expect(loaded!.files).toHaveLength(1);
      expect(loaded!.files![0].path).toBe("references/ref.md");
      expect(loaded!.files![0].content).toBe("Reference doc");
    });

    test("deleteSkill removes entire skill directory", async () => {
      const pkg: SkillPackage = {
        name: "deletable-pkg",
        description: "To be deleted",
        trigger: "delete",
        prompt: "Delete test",
        category: "user",
        files: [{ path: "nested/deep/file.txt", content: "nested" }],
      };
      await manager.createSkill(pkg);

      const skillDir = join(SKILLS_DIR, "deletable-pkg");
      expect(existsSync(skillDir)).toBe(true);

      const result = await manager.deleteSkill("deletable-pkg");
      expect(result).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    });

    test("getSkillPackage returns loaded package", async () => {
      const pkg: SkillPackage = {
        name: "gettable-pkg",
        description: "Gettable package",
        trigger: "get",
        prompt: "Get test",
        category: "user",
        config: { enabled: true },
      };
      await manager.createSkill(pkg);

      const gotten = manager.getSkillPackage("gettable-pkg");
      expect(gotten).toBeDefined();
      expect(gotten!.config!.enabled).toBe(true);
    });

    test("listSkillPackages returns all packages", async () => {
      await manager.createSkill({
        name: "pkg-one",
        description: "Package one",
        trigger: "one",
        prompt: "One",
        category: "user",
      });
      await manager.createSkill({
        name: "pkg-two",
        description: "Package two",
        trigger: "two",
        prompt: "Two",
        category: "user",
      });

      const pkgs = manager.listSkillPackages();
      expect(pkgs).toHaveLength(2);
      expect(pkgs.map((p) => p.name).sort()).toEqual(["pkg-one", "pkg-two"]);
    });
  });

  describe("Backward compatibility", () => {
    test("createSkill with legacy SkillDefinition still works", async () => {
      const legacy: SkillDefinition = {
        name: "legacy-skill",
        description: "Legacy skill",
        trigger: "legacy",
        prompt: "Legacy prompt",
        category: "user",
      };

      await manager.createSkill(legacy);

      // Legacy writes SKILL.md with frontmatter
      const skillDir = join(SKILLS_DIR, "legacy-skill");
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);

      // Auto-converted to package format
      expect(existsSync(join(skillDir, "SKILL.json"))).toBe(true);

      // SKILL.md contains prompt directly (no frontmatter)
      const mdContent = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(mdContent).toBe("Legacy prompt");

      // getSkill still works
      const gotten = manager.getSkill("legacy-skill");
      expect(gotten).toBeDefined();
      expect(gotten!.name).toBe("legacy-skill");
      expect(gotten!.prompt).toBe("Legacy prompt");
    });

    test("getSkill returns SkillDefinition from SkillPackage", async () => {
      const pkg: SkillPackage = {
        name: "pkg-as-def",
        description: "Package as definition",
        trigger: "pkg",
        prompt: "Package prompt",
        category: "user",
        config: { x: 1 },
      };
      await manager.createSkill(pkg);

      // getSkill should return SkillDefinition view
      const def = manager.getSkill("pkg-as-def");
      expect(def).toBeDefined();
      expect(def!.name).toBe("pkg-as-def");
      expect(def!.prompt).toBe("Package prompt");
      // SkillDefinition does not have config
      expect("config" in def!).toBe(false);
    });

    test("getAllSkills includes both legacy and packages", async () => {
      await manager.createSkill({
        name: "legacy-compat",
        description: "Legacy",
        trigger: "l",
        prompt: "L",
        category: "user",
      });
      await manager.createSkill({
        name: "pkg-compat",
        description: "Package",
        trigger: "p",
        prompt: "P",
        category: "user",
        config: { y: 2 },
      });

      const all = manager.getAllSkills();
      expect(all.find((s) => s.name === "legacy-compat")).toBeDefined();
      expect(all.find((s) => s.name === "pkg-compat")).toBeDefined();
    });

    test("cannot delete builtin skills", async () => {
      const result = await manager.deleteSkill("caveman");
      expect(result).toBe(false);
      expect(manager.getSkill("caveman")).toBeDefined();
    });
  });

  describe("init loads existing skill packages from disk", () => {
    test("init discovers and loads SkillPackages on disk", async () => {
      // Create a package on disk manually
      const skillDir = join(SKILLS_DIR, "preexisting-pkg");
      mkdirSync(skillDir, { recursive: true });
      require("fs").writeFileSync(
        join(skillDir, "SKILL.json"),
        JSON.stringify({
          name: "preexisting-pkg",
          description: "Pre-existing",
          trigger: "pre",
          category: "user",
          createdAt: 1000,
        })
      );
      require("fs").writeFileSync(join(skillDir, "SKILL.md"), "Pre-existing prompt");

      // Create a new manager instance that should pick up the package
      const newManager = new SkillManager(store, SKILLS_DIR);
      await newManager.init();

      const pkg = newManager.getSkillPackage("preexisting-pkg");
      expect(pkg).toBeDefined();
      expect(pkg!.prompt).toBe("Pre-existing prompt");

      const def = newManager.getSkill("preexisting-pkg");
      expect(def).toBeDefined();
      expect(def!.description).toBe("Pre-existing");
    });
  });
});
