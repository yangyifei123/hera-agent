/**
 * OpenCode Client Interface
 *
 * Type definition for the OpenCode SDK client used in Hera.
 * Based on actual API usage in team/manager.ts and tools/index.ts.
 */

export interface OpenCodeClient {
  session: {
    /**
     * Create a new OpenCode session
     * @returns Session ID (either data.id or data directly depending on SDK version)
     */
    create(args: {
      body: { parentID: string; title: string };
      query: { directory: string };
    }): Promise<{ data: { id: string } | string }>;

    /**
     * Send a prompt to an existing session asynchronously
     */
    promptAsync(args: {
      path: { id: string };
      body: {
        agent: string;
        parts: Array<{ type: string; text: string }>;
      };
    }): Promise<void>;

    /**
     * Get session status
     * @returns Session status (completed, idle, running, error)
     */
    status(args: { path: { id: string } }): Promise<{ data: { status: string } }>;

    /**
     * Get session messages
     * @returns Array of messages with role and parts
     */
    messages(args: { path: { id: string } }): Promise<{
      data: Array<{
        role: string;
        parts?: Array<{ text?: string }>;
      }>;
    }>;
  };
}
