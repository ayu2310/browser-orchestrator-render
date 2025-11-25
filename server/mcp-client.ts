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
   * Extract screenshot from response content
   * Handles multiple possible formats: base64 data urls, URLs, or embedded in various structures
   */
  private extractScreenshot(content: any[]): string | null {
    if (!Array.isArray(content)) return null;
    
    console.log("[MCP] Extracting screenshot from", content.length, "content items");
    
    for (const item of content) {
      console.log("[MCP] Item type:", item.type);
      
      // Handle image/resource type directly
      if (item.type === "image") {
        console.log("[MCP] Found direct image item");
        if (item.data && typeof item.data === "string") {
          return item.data;
        }
        if (item.source && item.source.data) {
          return item.source.data;
        }
      }
      
      if (item.type === "text" && item.text) {
        console.log("[MCP] Text content length:", item.text.length);
        
        // Pattern 1: Direct data:image URL (most common)
        let match = item.text.match(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/);
        if (match) {
          console.log("[MCP] Found screenshot via direct data URL");
          return match[0];
        }
        
        // Pattern 2: In markdown code block
        match = item.text.match(/```[\s\S]*?(data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+)[\s\S]*?```/);
        if (match) {
          console.log("[MCP] Found screenshot via markdown code block");
          return match[1];
        }
        
        // Pattern 3: In JSON object
        match = item.text.match(/"(?:image|screenshot|data)":\s*"(data:image\/[^"]+)"/);
        if (match) {
          console.log("[MCP] Found screenshot via JSON property");
          return match[1];
        }
        
        // Pattern 4: URL to image
        match = item.text.match(/(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp|gif))/i);
        if (match) {
          console.log("[MCP] Found screenshot via HTTP URL:", match[1]);
          return match[1];
        }
        
        // Pattern 5: Very long base64 string (likely screenshot)
        match = item.text.match(/^([A-Za-z0-9+/=]{1000,})$/);
        if (match) {
          console.log("[MCP] Found likely screenshot via base64 pattern");
          return "data:image/png;base64," + match[1];
        }
      }
    }
    
    console.log("[MCP] No screenshot found in response");
    return null;
  }

  /**
   * Create a new browser session
   */
  async createSession(): Promise<string> {
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) {
        throw new Error("Failed to connect to MCP server");
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
          console.log("[MCP] Screenshot extracted successfully, length:", screenshot.length);
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
