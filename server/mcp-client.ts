import type { McpFunctionCall } from "@shared/schema";

export interface McpServerConfig {
  url: string;
  apiKey?: string;
}

export class McpClient {
  private config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async listTools(): Promise<any[]> {
    try {
      const response = await fetch(`${this.config.url}/tools`, {
        headers: this.getHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to list tools: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error("Failed to list MCP tools:", error);
      return this.getMockTools();
    }
  }

  async callFunction(functionCall: Omit<McpFunctionCall, "result" | "error">): Promise<McpFunctionCall> {
    try {
      const response = await fetch(`${this.config.url}/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          function: functionCall.function,
          arguments: functionCall.arguments,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          ...functionCall,
          error: `MCP call failed: ${error}`,
        };
      }

      const result = await response.json();
      return {
        ...functionCall,
        result,
      };
    } catch (error) {
      console.error("MCP function call error:", error);
      return {
        ...functionCall,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private getMockTools(): any[] {
    return [
      {
        name: "navigate",
        description: "Navigate to a URL",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
          },
          required: ["url"],
        },
      },
      {
        name: "click",
        description: "Click an element",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of element to click" },
          },
          required: ["selector"],
        },
      },
      {
        name: "type",
        description: "Type text into an input",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of input element" },
            text: { type: "string", description: "Text to type" },
          },
          required: ["selector", "text"],
        },
      },
      {
        name: "screenshot",
        description: "Take a screenshot",
        parameters: {
          type: "object",
          properties: {
            fullPage: { type: "boolean", description: "Capture full page or viewport only" },
          },
        },
      },
      {
        name: "getText",
        description: "Get text content from an element",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of element" },
          },
          required: ["selector"],
        },
      },
    ];
  }
}
