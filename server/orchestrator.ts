import OpenAI from "openai";
import type { McpFunctionCall } from "@shared/schema";
import { McpClient } from "./mcp-client";

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
  private sessionCreated = false;

  constructor(config: OrchestratorConfig) {
    this.mcpClient = config.mcpClient;
    this.onLog = config.onLog;
  }

  async initialize(): Promise<void> {
    await this.onLog("info", "Connecting to MCP server and loading tools...");
    try {
      this.tools = await this.mcpClient.listTools();
      if (this.tools.length > 0) {
        await this.onLog("success", `Loaded ${this.tools.length} MCP tools`);
      } else {
        throw new Error("No tools available from MCP server");
      }
    } catch (error) {
      await this.onLog("error", `Failed to initialize: ${error instanceof Error ? error.message : "Unknown error"}`);
      throw error;
    }
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
      await this.onLog("info", `Starting task: ${prompt}`);

      // Create browser session
      await this.onLog("info", "Creating browser session...");
      const sessionId = await this.mcpClient.createSession();
      this.sessionCreated = true;
      await this.onLog("success", `Browser session created`);

      const systemPrompt = `You are a browser automation expert. Use the provided MCP tools to complete the user's task.

Guidelines:
- Think through each step carefully
- ALWAYS take a screenshot after navigation or any action to see the result
- Examine each screenshot carefully to understand the current state
- Use screenshots to verify success and plan precisely what to do next
- Never assume an action worked - always verify with screenshots
- If something fails, analyze the screenshot to understand why and try alternative approaches
- Report when the task is complete with evidence from screenshots
- Keep actions simple and direct
- When you receive a tool result with a screenshot, analyze it before deciding the next step

Important: Screenshots are essential for your planning. Always request or take screenshots after actions to see the current state of the browser before proceeding.`;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
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
      const maxIterations = 15;

      while (iterationCount < maxIterations && !this.cancelled) {
        iterationCount++;

        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_completion_tokens: 2048,
        });

        const message = response.choices[0].message;
        messages.push(message);

        if (message.content) {
          await this.onLog("info", message.content);
        }

        if (this.cancelled) {
          throw new Error("Task cancelled by user");
        }

        // If no tool calls, task is complete
        if (!message.tool_calls || message.tool_calls.length === 0) {
          const result = message.content || "Task completed successfully";
          await this.onLog("success", result);
          return { success: true, result };
        }

        // Execute tool calls
        for (const toolCall of message.tool_calls) {
          if (!("function" in toolCall)) continue;

          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          await this.onLog("info", `Executing: ${functionName}`);

          const result = await this.mcpClient.callFunction({
            function: functionName,
            arguments: functionArgs,
          });

          if (result.error) {
            await this.onLog("error", `${functionName} failed: ${result.error}`);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: result.error }),
            });
          } else {
            await this.onLog("success", `${functionName} completed`);

            // If screenshot captured, log it and include in message
            if (result.screenshot) {
              await this.onLog("info", "Screenshot captured", { screenshot: result.screenshot });
            }

            // Include screenshot in tool message for AI to see and plan from
            const toolResult: any = { success: true, result: result.result };
            if (result.screenshot) {
              toolResult.screenshot = result.screenshot;
            }

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            });
          }
        }
      }

      if (iterationCount >= maxIterations) {
        throw new Error("Task reached maximum iterations");
      }

      return { success: true, result: "Task completed" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.onLog("error", errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      // Always close the session
      if (this.sessionCreated) {
        await this.onLog("info", "Closing browser session...");
        try {
          await this.mcpClient.close();
          await this.onLog("success", "Browser session closed");
        } catch (error) {
          await this.onLog("error", `Failed to close session: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
    }
  }
}
