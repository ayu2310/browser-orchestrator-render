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
    let sessionId: string | null = null;
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured. Please add your OPENAI_API_KEY to secrets.");
      }

      await this.initialize();
      await this.onLog("info", `Executing task: ${prompt}`);

      // Create a new browser session
      await this.onLog("info", "Creating new browser session...");
      sessionId = await this.mcpClient.createSession();
      await this.onLog("success", `Browser session created: ${sessionId}`);

      const systemPrompt = `You are a browser automation orchestrator. You have access to browser automation tools via MCP (Model Context Protocol).

Your job is to:
1. Understand the user's automation task
2. Break it down into a series of browser actions
3. Call the appropriate MCP functions in the correct order
4. The sessionId is automatically managed - just call functions normally
5. After each action (navigate, click, fill, etc), take a screenshot to see the current state
6. Analyze the screenshot to determine the next action needed
7. Repeat until the task is complete

Important Guidelines:
- ALWAYS take a screenshot after navigation or any action to see the current state
- Use screenshots to identify elements to click, text to find, form fields to fill
- Reference what you see in screenshots when deciding what to do next
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
      const maxIterations = 20;

      while (iterationCount < maxIterations && !this.cancelled) {
        iterationCount++;
        console.log(`[Orchestrator] Iteration ${iterationCount}/${maxIterations}`);

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
              
              // Update sessionId if returned from call
              if (result.sessionId && !sessionId) {
                sessionId = result.sessionId;
              }

              // Automatically take a screenshot after navigation or action to see current state
              if (["browserbase_stagehand_act", "browserbase_stagehand_navigate"].includes(functionName)) {
                await this.onLog("info", "Taking screenshot to see current state...");
                const screenshotResult = await this.mcpClient.callFunction({
                  function: "browserbase_screenshot",
                  arguments: {},
                });
                
                if (!screenshotResult.error) {
                  if (screenshotResult.screenshot) {
                    console.log("[Orchestrator] Screenshot captured, logging to user");
                    await this.onLog("info", "Screenshot captured", { screenshot: screenshotResult.screenshot });
                  } else {
                    console.log("[Orchestrator] No screenshot in response:", screenshotResult);
                  }
                } else {
                  await this.onLog("warning", `Failed to capture screenshot: ${screenshotResult.error}`);
                }
              }
              
              // Include result and screenshot in the tool response so GPT can see what happened
              const toolResponse: any = {
                success: true,
                result: result.result,
              };
              
              // If screenshot was captured in the function call itself, include it
              if (result.screenshot) {
                toolResponse.screenshot = result.screenshot;
                toolResponse.note = "Screenshot is available - use this to determine next actions";
              }
              
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
      // Close the browser session
      if (sessionId) {
        await this.onLog("info", "Closing browser session...");
        await this.mcpClient.close();
      }
    }
  }
}
