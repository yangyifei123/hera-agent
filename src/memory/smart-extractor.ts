/**
 * Smart Memory Extractor
 * Automatically extracts decisions, fixes, and patterns from conversation messages
 * during session compaction for persistent memory storage.
 */

export interface ExtractedMemory {
  content: string;
  category: "decision" | "fix" | "pattern";
  confidence: number; // 0-1
}

/** Maximum memories extracted per compaction cycle */
const MAX_MEMORIES_PER_EXTRACTION = 5;

/** Minimum match length to consider meaningful */
const MIN_MATCH_LENGTH = 5;

/** Maximum match length to keep extracted content manageable */
const MAX_MATCH_LENGTH = 200;

/**
 * Extract memories from conversation messages using pattern matching.
 * Supports both English and Chinese text.
 *
 * @param messages - Array of conversation messages with role and content
 * @returns Deduplicated array of extracted memories, max 5
 */
/**
 * English keyword groups are anchored with `\b` and require whitespace before
 * the capture (`\s+`), so a keyword that is a substring of a larger word does
 * NOT match: "chosen" no longer fires the "chose" rule (capturing "n ..."), and
 * "unresolved" no longer fires the "resolved" rule (capturing " ..."). Chinese
 * keywords carry no `\b` (CJK has no ASCII word boundaries) and allow `\s*`.
 */
const DECISION_PATTERNS = [
  /\b(?:decided to|chose|will use|selected|opted for)\s+(.+?)(?:[.。，、；\n]|$)/gi,
  /\b(?:should|must|need to)\s+(?:use|implement|apply)\s+(.+?)(?:[.。，、；\n]|$)/gi,
  /(?:选择|决定使用|决定采用)\s*(.+?)(?:[.。，、；\n]|$)/g,
];
const FIX_PATTERNS = [
  /\b(?:fixed|resolved|patched)\s+(.+?)(?:[.。，、；\n]|$)/gi,
  /(?:修复了|解决了|修正了)\s*(.+?)(?:[.。，、；\n]|$)/g,
];
const PATTERN_PATTERNS = [
  /\b(?:always use|never use|never do|prefer)\s+(.+?)(?:[.。，、；\n]|$)/gi,
  /(?:绝不|必须|总是使用)\s*(.+?)(?:[.。，、；\n]|$)/g,
];

export function extractMemories(
  messages: Array<{ role: string; content: string }>
): ExtractedMemory[] {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  const collect = (
    patterns: RegExp[],
    category: ExtractedMemory["category"],
    confidence: number
  ): ExtractedMemory[] => {
    const out: ExtractedMemory[] = [];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (isValidMatch(match[1])) out.push({ content: match[1].trim(), category, confidence });
      }
    }
    return out;
  };

  const decisions = collect(DECISION_PATTERNS, "decision", 0.8);
  const fixes = collect(FIX_PATTERNS, "fix", 0.9);
  const patterns = collect(PATTERN_PATTERNS, "pattern", 0.7);

  // Deduplicate by exact (lowercased) content across all categories.
  const seen = new Set<string>();
  const dedupe = (list: ExtractedMemory[]): ExtractedMemory[] =>
    list.filter((m) => {
      const key = m.content.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Round-robin across categories so the cap is shared fairly: a session with
  // many decisions no longer shadows every fix and pattern (fixes carry the
  // highest confidence, so they lead each round).
  const buckets = [dedupe(fixes), dedupe(decisions), dedupe(patterns)];
  const result: ExtractedMemory[] = [];
  let progressed = true;
  while (result.length < MAX_MEMORIES_PER_EXTRACTION && progressed) {
    progressed = false;
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next && result.length < MAX_MEMORIES_PER_EXTRACTION) {
        result.push(next);
        progressed = true;
      }
    }
  }
  return result;
}

function isValidMatch(capture: string | undefined): boolean {
  if (!capture) return false;
  const trimmed = capture.trim();
  return trimmed.length >= MIN_MATCH_LENGTH && trimmed.length <= MAX_MATCH_LENGTH;
}
