/**
 * Session message access + auto-memory persistence.
 *
 * On current OpenCode the `experimental.session.compacting` hook input only
 * carries a `sessionID` (older versions passed `messages`). Messages must
 * therefore be fetched from the client by id rather than read off the hook
 * input. This module centralizes that fetch (previously duplicated in the
 * hera_distill_session tool) plus the auto-memory extraction/persistence so both
 * the compacting hook and the distillation tool share one tested path.
 */

import { createHash } from "node:crypto";
import type { MemoryStore } from "./store.js";
import { extractMemories } from "./smart-extractor.js";

export interface SessionMessage {
  info?: { role?: string };
  parts?: Array<{ text?: string }>;
}

export function isSessionMessage(message: unknown): message is SessionMessage {
  return typeof message === "object" && message !== null;
}

/** Minimal shape of the OpenCode client's session.messages API we depend on. */
export interface SessionMessagesClient {
  session?: {
    messages?: (args: { path: { id: string } }) => Promise<{ data?: unknown[] } | undefined>;
  };
}

export interface ConversationMessage {
  role: string;
  content: string;
}

/**
 * Fetch a session's messages as {role, content} pairs via the OpenCode client.
 * Returns [] when there is no client, no sessionID, no `session.messages`
 * method, or the fetch throws — callers treat empty as "nothing to do" so a
 * missing/unavailable client never breaks compaction.
 */
export async function fetchSessionMessages(
  client: SessionMessagesClient | undefined,
  sessionID: string | undefined
): Promise<ConversationMessage[]> {
  if (!client || !sessionID || typeof client.session?.messages !== "function") return [];
  try {
    const response = await client.session.messages({ path: { id: sessionID } });
    const raw = response?.data ?? [];
    return raw
      .filter(isSessionMessage)
      .filter(
        (m) => typeof m.info?.role === "string" && Array.isArray(m.parts) && m.parts.length > 0
      )
      .map((m) => ({
        role: m.info?.role ?? "unknown",
        content: (m.parts ?? [])
          .map((p) => (p && typeof p.text === "string" ? p.text : ""))
          .join(""),
      }));
  } catch {
    return [];
  }
}

/**
 * Deterministic content-hash id for an auto-memory so re-extracting an
 * overlapping message window on a later compaction overwrites the same entry
 * instead of accumulating a duplicate.
 */
export function autoMemoryId(category: string, content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  const hash = createHash("sha1").update(`${category}:${normalized}`).digest("hex").slice(0, 12);
  return `auto-${category}-${hash}`;
}

/**
 * Extract auto-memories from conversation messages and persist them under a
 * deterministic content-hash id. Returns the number of memories saved (capped
 * by the extractor). Safe to call repeatedly — duplicates collapse onto the
 * same id.
 */
export async function saveAutoMemories(
  store: MemoryStore,
  messages: ConversationMessage[]
): Promise<number> {
  if (messages.length === 0) return 0;
  const extracted = extractMemories(messages);
  for (const memory of extracted) {
    await store.save({
      id: autoMemoryId(memory.category, memory.content),
      type: memory.category,
      content: memory.content,
      timestamp: Date.now(),
      metadata: { source: "auto-memory", confidence: memory.confidence },
    });
  }
  return extracted.length;
}
