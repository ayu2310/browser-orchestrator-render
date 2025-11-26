import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpFunctionCall } from "@shared/schema";

export interface McpServerConfig {
  url: string;
  apiKey?: string;
}

export class McpClient {
  private config: McpServerConfig;
  private client: Client | null = null;
  private sessionId: string | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(this.config.url));

      this.client = new Client({
        name: "browserbase-orchestrator",
        version: "1.0.0",
      });

      await this.client.connect(transport);
    } catch (error) {
      console.error("Failed to connect to MCP server:", error);
      throw error;
    }
  }

  async listTools(): Promise<any[]> {
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) {
        throw new Error("Failed to connect to MCP server");
      }

      const response = await this.client.listTools();
      return Array.isArray(response.tools) ? response.tools : [];
    } catch (error) {
      console.error("Failed to list tools:", error);
      return [];
    }
  }

  /**
   * Extract sessionId from response content
   */
  private extractSessionId(content: any[]): string | null {
    if (!Array.isArray(content)) return null;
    
    for (const item of content) {
      if (item.type === "text" && item.text) {
        // Look for sessionId in response (format: sessions/{id})
        const match = item.text.match(/sessions\/([a-f0-9-]+)/i);
        if (match) {
          return match[1];
        }
      }
    }
    return null;
  }

  /**
   * Normalize screenshot to proper data:image format
   * Ensures all screenshots are in viewable format for UI
   */
  private normalizeScreenshot(screenshot: string): string {
    if (!screenshot) return screenshot;

    // If already in data:image format, return as-is
    if (screenshot.startsWith("data:image/")) {
      return screenshot;
    }

    // If it's a base64 string without prefix, add data:image/png;base64, prefix
    if (/^[A-Za-z0-9+/=]+$/.test(screenshot) && screenshot.length > 100) {
      return `data:image/png;base64,${screenshot}`;
    }

    // If it's a URL, return as-is (browser can handle it)
    if (screenshot.startsWith("http://") || screenshot.startsWith("https://")) {
      return screenshot;
    }

    // Default: assume it's base64 and add prefix
    return `data:image/png;base64,${screenshot}`;
  }

  /**
   * Extract screenshot from response content
   * Handles multiple possible formats: base64 data urls, URLs, or embedded in various structures
   * Returns normalized screenshot in proper viewable format
   */
  private extractScreenshot(content: any[]): string | null {
    if (!Array.isArray(content)) return null;
    
    console.log("[MCP] Extracting screenshot from", content.length, "content items");
    
    let rawScreenshot: string | null = null;
    
    for (const item of content) {
      console.log("[MCP] Item type:", item.type);
      
      // Handle image/resource type directly
      if (item.type === "image") {
        console.log("[MCP] Found direct image item");
        if (item.data && typeof item.data === "string") {
          rawScreenshot = item.data;
          break;
        }
        if (item.source && item.source.data) {
          rawScreenshot = item.source.data;
          break;
        }
        if (item.source && item.source.uri) {
          rawScreenshot = item.source.uri;
          break;
        }
      }
      
      if (item.type === "text" && item.text) {
        console.log("[MCP] Text content length:", item.text.length);
        
        // Pattern 1: Direct data:image URL (most common)
        let match = item.text.match(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/);
        if (match) {
          console.log("[MCP] Found screenshot via direct data URL");
          rawScreenshot = match[0];
          break;
        }
        
        // Pattern 2: In markdown code block
        match = item.text.match(/```[\s\S]*?(data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+)[\s\S]*?```/);
        if (match) {
          console.log("[MCP] Found screenshot via markdown code block");
          rawScreenshot = match[1];
          break;
        }
        
        // Pattern 3: In JSON object
        match = item.text.match(/"(?:image|screenshot|data)":\s*"(data:image\/[^"]+)"/);
        if (match) {
          console.log("[MCP] Found screenshot via JSON property");
          rawScreenshot = match[1];
          break;
        }
        
        // Pattern 4: URL to image
        match = item.text.match(/(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp|gif))/i);
        if (match) {
          console.log("[MCP] Found screenshot via HTTP URL:", match[1]);
          rawScreenshot = match[1];
          break;
        }
        
        // Pattern 5: Very long base64 string (likely screenshot)
        match = item.text.match(/^([A-Za-z0-9+/=]{1000,})$/);
        if (match) {
          console.log("[MCP] Found likely screenshot via base64 pattern");
          rawScreenshot = match[1];
          break;
        }
      }
    }
    
    if (rawScreenshot) {
      const normalized = this.normalizeScreenshot(rawScreenshot);
      console.log("[MCP] Screenshot normalized, format:", normalized.substring(0, 30));
      return normalized;
    }
    
    console.log("[MCP] No screenshot found in response");
    return null;
  }

  /**
   * Create a new browser session or reuse an existing one for replay
   */
  async createSession(replaySessionId?: string): Promise<string> {
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) {
        throw new Error("Failed to connect to MCP server");
      }

      // If replaySessionId is provided, use it directly (for replay mode)
      if (replaySessionId) {
        this.sessionId = replaySessionId;
        console.log("[MCP] Reusing session for replay:", replaySessionId);
        return replaySessionId;
      }

      const result = await this.client.callTool({
        name: "browserbase_session_create",
        arguments: {},
      });

      const sessionId = this.extractSessionId((result.content as any[]) || []);
      if (!sessionId) {
        throw new Error("Failed to extract sessionId from response");
      }

      this.sessionId = sessionId;
      console.log("[MCP] Session created:", sessionId);
      return sessionId;
    } catch (error) {
      console.error("Failed to create session:", error);
      throw error;
    }
  }

  /**
   * Close the current browser session
   */
  async closeSession(): Promise<void> {
    if (!this.sessionId) return;
    
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) return;

      await this.client.callTool({
        name: "browserbase_session_close",
        arguments: { sessionId: this.sessionId },
      });

      console.log("[MCP] Session closed:", this.sessionId);
      this.sessionId = null;
    } catch (error) {
      console.error("Failed to close session:", error);
    }
  }

  /**
   * Call an MCP function with automatic sessionId injection
   */
  async callFunction(
    functionCall: Omit<McpFunctionCall, "result" | "error">
  ): Promise<McpFunctionCall & { sessionId?: string; screenshot?: string }> {
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) {
        throw new Error("Failed to connect to MCP server");
      }

      // Add sessionId to arguments if we have one (except for session_create)
      const arguments_with_session = {
        ...functionCall.arguments,
      };
      
      if (this.sessionId && functionCall.function !== "browserbase_session_create") {
        arguments_with_session.sessionId = this.sessionId;
      }

      console.log(`[MCP] Calling ${functionCall.function}`, arguments_with_session);
      
      const result = await this.client.callTool({
        name: functionCall.function,
        arguments: arguments_with_session,
      });

      console.log(`[MCP] Response received from ${functionCall.function}, content items:`, (result.content as any[])?.length);

      let resultText = "";
      let extractedSessionId = this.sessionId;
      let screenshot: string | null = null;

      const content = (result.content as any[]) || [];
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "text" && typeof item.text === "string") {
            resultText += item.text;

            // Extract sessionId from session_create responses
            if (functionCall.function === "browserbase_session_create") {
              const sessionIdMatch = this.extractSessionId(content);
              if (sessionIdMatch) {
                extractedSessionId = sessionIdMatch;
                this.sessionId = sessionIdMatch;
              }
            }
          }
        }

        // Try to extract screenshot from any response
        const potentialScreenshot = this.extractScreenshot(content);
        if (potentialScreenshot) {
          screenshot = potentialScreenshot;
          console.log("[MCP] Screenshot extracted and normalized, length:", screenshot.length, "format:", screenshot.substring(0, 30));
        }
      }

      const response: any = {
        ...functionCall,
        result: resultText,
        sessionId: extractedSessionId,
      };

      if (screenshot) {
        response.screenshot = screenshot;
        console.log("[MCP] Response includes screenshot");
      }

      return response;
    } catch (error) {
      console.error("MCP function call error:", error);
      return {
        ...functionCall,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async close(): Promise<void> {
    await this.closeSession();
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error("Error closing MCP client:", error);
      }
    }
  }
}
