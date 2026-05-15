import { describe, it, expect } from "bun:test";
import {
  buildHierarchy,
  findNode,
  getDelegates,
  assignTask,
  getChainToRoot,
  countNodes,
  formatTree,
} from "./tree-manager.js";

describe("tree-manager", () => {
  describe("buildHierarchy", () => {
    it("should return empty array for no members", () => {
      expect(buildHierarchy([])).toEqual([]);
    });

    it("should make first member root", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "architect" },
      ]);
      expect(tree).toHaveLength(1);
      expect(tree[0].agent).toBe("lead");
      expect(tree[0].role).toBe("root");
    });

    it("should add subsequent members as children of root", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "architect" },
        { agentName: "dev1", role: "developer" },
        { agentName: "dev2", role: "developer" },
      ]);
      expect(tree).toHaveLength(1);
      expect(tree[0].role).toBe("root");
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children![0].agent).toBe("dev1");
      expect(tree[0].children![1].agent).toBe("dev2");
    });

    it("should assign manager role when specified", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
        { agentName: "mid", role: "manager" },
      ]);
      expect(tree[0].children![0].role).toBe("manager");
    });

    it("should assign worker role for non-root non-manager", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
        { agentName: "worker", role: "dev" },
      ]);
      expect(tree[0].children![0].role).toBe("worker");
    });

    it("should generate unique IDs for each node", () => {
      const tree = buildHierarchy([
        { agentName: "a", role: "r" },
        { agentName: "b", role: "w" },
      ]);
      expect(tree[0].id).toMatch(/^node-/);
      expect(tree[0].children![0].id).toMatch(/^node-/);
      expect(tree[0].id).not.toBe(tree[0].children![0].id);
    });
  });

  describe("findNode", () => {
    it("should find root node", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
      ]);
      const found = findNode(tree, "lead");
      expect(found).toBeDefined();
      expect(found!.agent).toBe("lead");
    });

    it("should find child node", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
        { agentName: "dev", role: "dev" },
      ]);
      const found = findNode(tree, "dev");
      expect(found).toBeDefined();
      expect(found!.agent).toBe("dev");
    });

    it("should return undefined for missing agent", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
      ]);
      expect(findNode(tree, "ghost")).toBeUndefined();
    });
  });

  describe("getDelegates", () => {
    it("should return child agent names", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
        { agentName: "dev1", role: "dev" },
        { agentName: "dev2", role: "dev" },
      ]);
      const delegates = getDelegates(tree[0]);
      expect(delegates).toEqual(["dev1", "dev2"]);
    });

    it("should return empty array for leaf node", () => {
      const tree = buildHierarchy([
        { agentName: "solo", role: "dev" },
      ]);
      expect(getDelegates(tree[0])).toEqual([]);
    });
  });

  describe("assignTask", () => {
    it("should assign task to existing agent", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
        { agentName: "dev", role: "dev" },
      ]);
      const result = assignTask(tree, "Fix bug #42", "dev");
      expect(result.node.agent).toBe("dev");
      expect(result.task).toBe("Fix bug #42");
    });

    it("should throw for missing agent", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
      ]);
      expect(() => assignTask(tree, "task", "ghost")).toThrow(
        'Agent "ghost" not found',
      );
    });

    it("should assign task to root", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
      ]);
      const result = assignTask(tree, "Plan sprint", "lead");
      expect(result.node.role).toBe("root");
    });
  });

  describe("getChainToRoot", () => {
    it("should return path from root to target", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
        { agentName: "mid", role: "manager" },
      ]);
      const chain = getChainToRoot(tree, "mid");
      expect(chain).toHaveLength(2);
      expect(chain[0].agent).toBe("root");
      expect(chain[1].agent).toBe("mid");
    });

    it("should return single element for root", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
      ]);
      const chain = getChainToRoot(tree, "root");
      expect(chain).toHaveLength(1);
      expect(chain[0].role).toBe("root");
    });

    it("should return empty for missing agent", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
      ]);
      expect(getChainToRoot(tree, "ghost")).toEqual([]);
    });
  });

  describe("countNodes", () => {
    it("should count all nodes in tree", () => {
      const tree = buildHierarchy([
        { agentName: "root", role: "lead" },
        { agentName: "a", role: "dev" },
        { agentName: "b", role: "dev" },
        { agentName: "c", role: "dev" },
      ]);
      expect(countNodes(tree)).toBe(4);
    });

    it("should return 0 for empty tree", () => {
      expect(countNodes([])).toBe(0);
    });
  });

  describe("formatTree", () => {
    it("should format single node tree", () => {
      const tree = buildHierarchy([
        { agentName: "solo", role: "lead" },
      ]);
      const formatted = formatTree(tree);
      expect(formatted).toContain("solo");
      expect(formatted).toContain("root");
    });

    it("should format multi-node tree with indentation", () => {
      const tree = buildHierarchy([
        { agentName: "lead", role: "arch" },
        { agentName: "dev", role: "dev" },
      ]);
      const formatted = formatTree(tree);
      expect(formatted).toContain("lead");
      expect(formatted).toContain("dev");
    });
  });
});
