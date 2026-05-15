import { randomUUID } from "node:crypto";

export interface TreeNode {
  id: string;
  agent: string;
  role: "root" | "manager" | "worker";
  children?: TreeNode[];
  delegates?: string[];
}

export interface TaskAssignment {
  node: TreeNode;
  task: string;
}

/**
 * Build a tree hierarchy from flat member list.
 * First member becomes root, subsequent members become children.
 */
export function buildHierarchy(
  members: { agentName: string; role: string }[],
): TreeNode[] {
  if (members.length === 0) return [];

  const nodes: TreeNode[] = members.map((m, i) => ({
    id: `node-${randomUUID().slice(0, 8)}`,
    agent: m.agentName,
    role: (i === 0 ? "root" : m.role === "manager" ? "manager" : "worker") as TreeNode["role"],
    children: [],
    delegates: [],
  }));

  // First node is root, rest are children of root
  if (nodes.length > 1) {
    nodes[0].children = nodes.slice(1);
  }

  return [nodes[0]];
}

/**
 * Find a node by agent name in the tree (recursive DFS).
 */
export function findNode(
  tree: TreeNode[],
  agentName: string,
): TreeNode | undefined {
  for (const node of tree) {
    if (node.agent === agentName) return node;
    if (node.children) {
      const found = findNode(node.children, agentName);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Get all delegates (direct children agent names) of a node.
 */
export function getDelegates(node: TreeNode): string[] {
  if (!node.children || node.children.length === 0) return [];
  return node.children.map((child) => child.agent);
}

/**
 * Assign a task to a specific node. Returns assignment record.
 */
export function assignTask(
  tree: TreeNode[],
  task: string,
  agentName: string,
): TaskAssignment {
  const node = findNode(tree, agentName);
  if (!node) {
    throw new Error(`Agent "${agentName}" not found in tree hierarchy.`);
  }
  return { node, task };
}

/**
 * Get the full chain from root to a given agent.
 */
export function getChainToRoot(
  tree: TreeNode[],
  agentName: string,
): TreeNode[] {
  const path: TreeNode[] = [];

  function dfs(nodes: TreeNode[], target: string): boolean {
    for (const node of nodes) {
      path.push(node);
      if (node.agent === target) return true;
      if (node.children && dfs(node.children, target)) return true;
      path.pop();
    }
    return false;
  }

  dfs(tree, agentName);
  return path;
}

/**
 * Count total nodes in tree.
 */
export function countNodes(tree: TreeNode[]): number {
  let count = 0;
  for (const node of tree) {
    count += 1;
    if (node.children) count += countNodes(node.children);
  }
  return count;
}

/**
 * Format tree hierarchy for display.
 */
export function formatTree(tree: TreeNode[], indent: number = 0): string {
  const lines: string[] = [];
  for (const node of tree) {
    const prefix = "  ".repeat(indent) + (indent === 0 ? "" : "├─ ");
    const roleLabel = node.role === "root" ? "👑" : node.role === "manager" ? "📋" : "⚙️";
    lines.push(`${prefix}${roleLabel} ${node.agent} (${node.role})`);
    if (node.children && node.children.length > 0) {
      lines.push(formatTree(node.children, indent + 1));
    }
  }
  return lines.join("\n");
}
