import OpenAI from "openai";
import type { McpFunctionCall } from "@shared/schema";
import { McpClient } from "./mcp-client";

// User requested gpt-4o model
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
    await this.onLog("info", "Initializing orchestrator and connecting to MCP server...");
    try {
      this.tools = await this.mcpClient.listTools();
      if (this.tools.length > 0) {
        await this.onLog("success", `Loaded ${this.tools.length} MCP tools`);
      } else {
        await this.onLog("warning", "No tools available from MCP server");
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
      await this.onLog("info", `Executing task: ${prompt}`);

      const systemPrompt = `You are a browser automation orchestrator. You have access to browser automation tools via MCP (Model Context Protocol).

Your job is to:
1. Understand the user's automation task
2. Break it down into a series of browser actions
3. Call the appropriate MCP functions in the correct order
4. Always pass the flowState returned from each call to the next call to maintain the browser session
5. After each action (navigate, click, fill, etc), take a screenshot using browserbase_screenshot to see the current state
6. Analyze the screenshot to determine the next action needed
7. Repeat until the task is complete

Important Guidelines:
- ALWAYS take a screenshot after navigation or any action to see the current state
- Use screenshots to identify elements to click, text to find, form fields to fill
- Reference what you see in screenshots when deciding what to do next
- The flowState is critical for session continuity - pass it with every tool call
- Be persistent: if an action fails, try alternative approaches based on what you see in the screenshot
- When you see the desired result in a screenshot, report success

Available tools:
${this.tools.length > 0 ? JSON.stringify(this.tools, null, 2) : "No tools currently available. Try to help the user understand what went wrong."}`;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: systemPrompt,
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
          model: "gpt-4o",
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
            if (!("function" in toolCall)) continue;
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
              
              // Automatically take a screenshot after actions to see current state
              if (["browserbase_stagehand_act", "browserbase_stagehand_navigate"].includes(functionName)) {
                const screenshotResult = await this.mcpClient.callFunction({
                  function: "browserbase_screenshot",
                  arguments: { flowState: result.flowState },
                });
                
                if (!screenshotResult.error && screenshotResult.result) {
                  const screenshotText = screenshotResult.result;
                  const screenshotMatch = screenshotText.match(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/);
                  if (screenshotMatch) {
                    await this.onLog("info", "Screenshot captured", { screenshot: screenshotMatch[0] });
                  }
                }
              }
              
              // Include flowState info in the tool response
              const toolResponse = {
                success: true,
                result: result.result,
                ...(result.flowState && { flowState: result.flowState }),
              };
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse),
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
    } finally {
      await this.mcpClient.close();
    }
  }
}
