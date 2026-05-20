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
export function extractMemories(
  messages: Array<{ role: string; content: string }>
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  // Decision patterns (English + Chinese)
  const decisionPatterns = [
    /(?:decided to|chose|will use|选择|决定使用|决定采用)\s*(.+?)(?:[.。，、；\n]|$)/gi,
    /(?:should|must|need to)\s+(?:use|implement|apply)\s+(.+?)(?:[.。，、；\n]|$)/gi,
  ];

  // Fix patterns (English + Chinese)
  const fixPatterns = [
    /(?:fixed|resolved|bug was|修复了|解决了|修正了)\s*(.+?)(?:[.。，、；\n]|$)/gi,
  ];

  // Pattern/habit patterns (English + Chinese)
  const patternPatterns = [
    /(?:always use|never do|绝不|必须|总是使用)\s*(.+?)(?:[.。，、；\n]|$)/gi,
  ];

  // Extract decisions
  for (const pattern of decisionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (isValidMatch(match[1])) {
        memories.push({
          content: match[1].trim(),
          category: "decision",
          confidence: 0.8,
        });
      }
    }
  }

  // Extract fixes
  for (const pattern of fixPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (isValidMatch(match[1])) {
        memories.push({
          content: match[1].trim(),
          category: "fix",
          confidence: 0.9,
        });
      }
    }
  }

  // Extract patterns
  for (const pattern of patternPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (isValidMatch(match[1])) {
        memories.push({
          content: match[1].trim(),
          category: "pattern",
          confidence: 0.7,
        });
      }
    }
  }

  // Deduplicate by exact content
  const seen = new Set<string>();
  const unique = memories.filter((m) => {
    const key = m.content.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, MAX_MEMORIES_PER_EXTRACTION);
}

function isValidMatch(capture: string | undefined): boolean {
  if (!capture) return false;
  const trimmed = capture.trim();
  return trimmed.length >= MIN_MATCH_LENGTH && trimmed.length <= MAX_MATCH_LENGTH;
}
