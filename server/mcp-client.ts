import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpFunctionCall } from "@shared/schema";

export interface McpServerConfig {
  url: string;
  apiKey?: string;
}

interface FlowState {
  cacheKey?: string;
  startingUrl?: string;
  browserbaseSessionId?: string;
  actions?: Array<any>;
  [key: string]: any;
}

export class McpClient {
  private config: McpServerConfig;
  private client: Client | null = null;
  private flowState: FlowState = {};

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

  async callFunction(
    functionCall: Omit<McpFunctionCall, "result" | "error">
  ): Promise<McpFunctionCall & { flowState?: FlowState }> {
    try {
      if (!this.client) {
        await this.connect();
      }

      if (!this.client) {
        throw new Error("Failed to connect to MCP server");
      }

      // Add flowState to arguments for session reuse
      const arguments_with_flowstate = {
        ...functionCall.arguments,
        flowState: this.flowState,
      };

      const result = await this.client.callTool({
        name: functionCall.function,
        arguments: arguments_with_flowstate,
      });

      // Extract flowState from response
      let extractedFlowState = this.flowState;
      let resultText = "";

      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === "text" && typeof content.text === "string") {
            resultText += content.text;

            // Extract flowState from response text
            const flowStateMatch = content.text.match(
              /flowState \(persist externally\): ({[\s\S]*?})(?=\n|$)/
            );
            if (flowStateMatch) {
              try {
                extractedFlowState = JSON.parse(flowStateMatch[1]);
              } catch (e) {
                console.error("Failed to parse flowState:", e);
              }
            }
          }
        }
      }

      // Update internal flowState
      this.flowState = extractedFlowState;

      return {
        ...functionCall,
        result: resultText,
        flowState: extractedFlowState,
      };
    } catch (error) {
      console.error("MCP function call error:", error);
      return {
        ...functionCall,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  getFlowState(): FlowState {
    return this.flowState;
  }

  setFlowState(state: FlowState): void {
    this.flowState = state;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error("Error closing MCP client:", error);
      }
    }
  }
}
