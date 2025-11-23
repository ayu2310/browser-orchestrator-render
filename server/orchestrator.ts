import OpenAI from "openai";
import type { McpFunctionCall } from "@shared/schema";
import { McpClient } from "./mcp-client";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured. Please add your OPENAI_API_KEY to secrets.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface OrchestratorConfig {
  mcpClient: McpClient;
  onLog: (level: "info" | "success" | "error" | "warning", message: string, details?: any) => Promise<void>;
}

export class Orchestrator {
  private mcpClient: McpClient;
  private onLog: OrchestratorConfig["onLog"];
  private tools: any[] = [];
  private cancelled = false;

  constructor(config: OrchestratorConfig) {
    this.mcpClient = config.mcpClient;
    this.onLog = config.onLog;
  }

  async initialize(): Promise<void> {
    await this.onLog("info", "Initializing orchestrator...");
    this.tools = await this.mcpClient.listTools();
    await this.onLog("success", `Loaded ${this.tools.length} MCP tools`);
  }

  cancel(): void {
    this.cancelled = true;
  }

  async execute(prompt: string): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured. Please add your OPENAI_API_KEY to secrets.");
      }

      await this.initialize();
      await this.onLog("info", `Executing task: ${prompt}`);

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `You are a browser automation orchestrator. You have access to browser automation tools via MCP (Model Context Protocol).
          
Your job is to:
1. Understand the user's automation task
2. Break it down into a series of browser actions
3. Call the appropriate MCP functions in the correct order
4. Return the final result

Available tools: ${JSON.stringify(this.tools, null, 2)}

Be methodical and explain each step you're taking.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ];

      const tools = this.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      let iterationCount = 0;
      const maxIterations = 10;

      while (iterationCount < maxIterations && !this.cancelled) {
        iterationCount++;

        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
          model: "gpt-5",
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_completion_tokens: 4096,
        });

        const message = response.choices[0].message;
        messages.push(message);

        if (message.content) {
          await this.onLog("info", message.content);
        }

        if (this.cancelled) {
          throw new Error("Task cancelled by user");
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            await this.onLog(
              "info",
              `Calling ${functionName} with args: ${JSON.stringify(functionArgs)}`
            );

            const result = await this.mcpClient.callFunction({
              function: functionName,
              arguments: functionArgs,
            });

            if (result.error) {
              await this.onLog("error", `Function ${functionName} failed: ${result.error}`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: result.error }),
              });
            } else {
              await this.onLog("success", `Function ${functionName} completed successfully`);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.result || { success: true }),
              });
            }
          }
        } else {
          const finalResult = message.content || "Task completed";
          await this.onLog("success", `Task completed: ${finalResult}`);
          return { success: true, result: finalResult };
        }
      }

      if (iterationCount >= maxIterations) {
        throw new Error("Max iterations reached");
      }

      return { success: true, result: "Task completed" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.onLog("error", `Task failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}
