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
  private lastScreenshot: string | null = null;
  private replayState: { sessionId: string; url?: string; pages?: string[]; actions: Array<{ function: string; arguments: Record<string, any> }> } | null = null;

  constructor(config: OrchestratorConfig) {
    this.mcpClient = config.mcpClient;
    this.onLog = config.onLog;
  }

  getReplayState() {
    // Return replayState if it exists and has a sessionId (URL and actions are optional)
    if (this.replayState && this.replayState.sessionId) {
      return this.replayState;
    }
    return null;
  }

  /**
   * Clean function names for UI display - remove browserbase_ and stagehand_ prefixes
   */
  private cleanFunctionName(functionName: string): string {
    return functionName
      .replace(/^browserbase_/i, "")
      .replace(/^stagehand_/i, "")
      .replace(/_/g, " ");
  }

  /**
   * Clean arguments for UI display - remove internal details
   */
  private cleanArgsForUI(args: Record<string, any>): Record<string, any> {
    const cleaned = { ...args };
    delete cleaned.sessionId;
    // Clean any nested function names in arguments
    if (cleaned.observation && typeof cleaned.observation === 'object') {
      const obs = { ...cleaned.observation };
      if (obs.method) obs.method = this.cleanFunctionName(obs.method);
      cleaned.observation = obs;
    }
    return cleaned;
  }

  async log(level: "info" | "success" | "error" | "warning", message: string, details?: any): Promise<void> {
    await this.onLog(level, message, details);
  }

  async initialize(): Promise<void> {
    await this.onLog("info", "Initializing orchestrator and connecting to MCP server...");
    try {
      // Ensure MCP client is connected
      await this.mcpClient.connect();
      await this.onLog("info", "MCP server connection established");
      
      this.tools = await this.mcpClient.listTools();
      if (this.tools.length > 0) {
        await this.onLog("success", `Loaded ${this.tools.length} MCP tools`);
        // Log available tool names for debugging (cleaned for UI)
        const toolNames = this.tools.map(t => this.cleanFunctionName(t.name)).join(", ");
        await this.onLog("info", `Available tools: ${toolNames}`);
      } else {
        await this.onLog("error", "No tools available from MCP server. Check MCP server connection and configuration.");
        throw new Error("No MCP tools available. Cannot proceed with automation.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await this.onLog("error", `Failed to initialize: ${errorMessage}`);
      console.error("[Orchestrator] Initialization error:", error);
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
      
      // Initialize replay state
      this.replayState = {
        sessionId,
        pages: [],
        actions: [],
      };

      const systemPrompt = `You are a browser automation orchestrator. You have access to browser automation tools via MCP (Model Context Protocol).

Your job is to:
1. Understand the user's automation task
2. Break it down into a series of browser actions
3. Call the appropriate MCP functions in the correct order
4. The sessionId is automatically managed - just call functions normally
5. CRITICAL: After EVERY action (navigate, act, observe, etc), a screenshot will be automatically taken
6. You MUST analyze the screenshot images provided to determine the next action needed
7. Use the visual information from screenshots to identify elements, text, buttons, forms, etc.
8. Repeat until the task is complete

CRITICAL WORKFLOW:
- Step 1: Call browserbase_stagehand_navigate to go to a URL
- Step 2: Screenshot is automatically taken and shown to you - ANALYZE IT
- Step 3: Based on screenshot, call browserbase_stagehand_observe to find elements OR browserbase_stagehand_act to perform actions
- Step 4: Screenshot is automatically taken after each action - ANALYZE IT
- Step 5: Continue until task is complete

Important Guidelines:
- Screenshots are automatically captured after navigate and act calls - you will see them in the response
- ALWAYS analyze the screenshot before deciding the next action
- Use browserbase_stagehand_observe with returnAction: true to get deterministic selectors
- Use browserbase_stagehand_act with either 'action' (natural language) or 'observation' (deterministic)
- If an action fails, look at the screenshot to understand why and try alternative approaches
- When you see the desired result in the screenshot, report success

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

            // Clean function name and args for UI display
            const cleanFunctionName = this.cleanFunctionName(functionName);
            const cleanArgs = this.cleanArgsForUI(functionArgs);
            const cleanArgsStr = Object.keys(cleanArgs).length > 0 ? JSON.stringify(cleanArgs) : "";

            await this.onLog(
              "info",
              `Calling ${cleanFunctionName}${cleanArgsStr ? ` with args: ${cleanArgsStr}` : ""}`
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
                content: `Error: ${result.error}`,
              });
            } else {
              // Clean function name for UI display
              const cleanFunctionName = this.cleanFunctionName(functionName);
              await this.onLog("success", `${cleanFunctionName} completed successfully`);
              
              // Update sessionId if returned from call
              if (result.sessionId && !sessionId) {
                sessionId = result.sessionId;
              }

              // Capture replay state: ALL function calls in exact execution order
              // This preserves the sequence: navigate -> act -> extract -> navigate -> etc.
              if (this.replayState) {
                // Capture navigate calls
                if (functionName === "browserbase_stagehand_navigate" && functionArgs.url) {
                  // Store first URL for backward compatibility
                  if (!this.replayState.url) {
                    this.replayState.url = functionArgs.url;
                  }
                  // Store all pages in order (for backward compatibility)
                  if (!this.replayState.pages) {
                    this.replayState.pages = [];
                  }
                  // Only add if it's a new page (avoid duplicates of consecutive navigations)
                  if (this.replayState.pages.length === 0 || 
                      this.replayState.pages[this.replayState.pages.length - 1] !== functionArgs.url) {
                    this.replayState.pages.push(functionArgs.url);
                  }
                  
                  // Store navigate call in actions array to preserve order
                  const actionArgs = { ...functionArgs };
                  delete actionArgs.sessionId;
                  this.replayState.actions.push({
                    function: functionName,
                    arguments: actionArgs,
                  });
                }
                // Capture act, extract, and screenshot calls for replay
                else if (functionName === "browserbase_stagehand_act" || 
                         functionName === "browserbase_stagehand_extract" || 
                         functionName === "browserbase_screenshot") {
                  // Store the action for replay (without sessionId to avoid duplication)
                  const actionArgs = { ...functionArgs };
                  delete actionArgs.sessionId;
                  this.replayState.actions.push({
                    function: functionName,
                    arguments: actionArgs,
                  });
                }
              }

              // Check if the function result itself contains a screenshot
              let screenshotData: string | null = null;
              if (result.screenshot) {
                screenshotData = result.screenshot;
                this.lastScreenshot = screenshotData;
                console.log("[Orchestrator] Screenshot found in function result, length:", screenshotData.length);
                await this.onLog("info", "Screenshot captured", { screenshot: screenshotData });
              }
              
              // Automatically take a screenshot after ANY action that affects the page state
              // This includes: navigate, act, observe (if it changes state), etc.
              const shouldTakeScreenshot = [
                "browserbase_stagehand_act",
                "browserbase_stagehand_navigate",
                "browserbase_stagehand_observe", // Sometimes observe can trigger page changes
              ].includes(functionName);
              
              if (!screenshotData && shouldTakeScreenshot) {
                await this.onLog("info", "Taking screenshot to see current state...");
                try {
                const screenshotResult = await this.mcpClient.callFunction({
                  function: "browserbase_screenshot",
                    arguments: { sessionId: result.sessionId || sessionId },
                });
                
                if (!screenshotResult.error) {
                  if (screenshotResult.screenshot) {
                    screenshotData = screenshotResult.screenshot;
                    this.lastScreenshot = screenshotData;
                      console.log("[Orchestrator] Screenshot captured and normalized, length:", screenshotData.length);
                      // Log screenshot for UI display - ensure it's in proper format
                      // Note: storage.addLog will extract screenshot from details and add it to log.screenshot
                    await this.onLog("info", "Screenshot captured", { screenshot: screenshotData });
                    } else {
                      await this.onLog("warning", "Screenshot function returned no image data");
                  }
                } else {
                  await this.onLog("warning", `Failed to capture screenshot: ${screenshotResult.error}`);
                  }
                } catch (screenshotError) {
                  await this.onLog("warning", `Screenshot capture error: ${screenshotError instanceof Error ? screenshotError.message : "Unknown error"}`);
                }
              }
              
              // Send tool result - include screenshot reference in text so GPT knows we captured it
              const resultMessage = screenshotData 
                ? `Success. Result: ${result.result || "Action completed"}. Screenshot captured and shown below.`
                : `Success. Result: ${result.result || "Action completed"}`;
              
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: resultMessage,
              });
              
              // If we have a screenshot, add it as the next user message so GPT can see it
              if (screenshotData) {
                // Ensure we have proper data URL format (should already be normalized by MCP client)
                let imageUrl = screenshotData;
                if (!screenshotData.startsWith("data:image")) {
                  imageUrl = `data:image/png;base64,${screenshotData}`;
                }
                
                messages.push({
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: {
                        url: imageUrl,
                      },
                    },
                    {
                      type: "text",
                      text: "This is the current screenshot of the page. Examine it carefully to determine your next action.",
                    },
                  ],
                } as OpenAI.Chat.ChatCompletionMessageParam);
              }
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
      let errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Clean up HTML/502 error messages
      if (errorMessage.includes("<!DOCTYPE html>") || errorMessage.includes("<html")) {
        if (errorMessage.includes("502") || errorMessage.match(/HTTP 502/)) {
          errorMessage = "MCP server is unavailable (502 Bad Gateway). The server may be down or overloaded. Please try again later.";
        } else if (errorMessage.includes("503") || errorMessage.match(/HTTP 503/)) {
          errorMessage = "MCP server is temporarily unavailable (503 Service Unavailable). Please try again later.";
        } else if (errorMessage.includes("504") || errorMessage.match(/HTTP 504/)) {
          errorMessage = "MCP server request timed out (504 Gateway Timeout). Please try again later.";
        } else {
          errorMessage = "MCP server returned an error. The server may be down or misconfigured.";
        }
      } else if (errorMessage.match(/\(HTTP 502\)/)) {
        errorMessage = "MCP server is unavailable (502 Bad Gateway). The server may be down or overloaded.";
      }
      
      await this.onLog("error", `Task failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      // Close the browser session
      if (sessionId) {
        await this.onLog("info", "Closing browser session...");
        await this.mcpClient.close();
      }
      
      // Ensure replayState is valid before returning
      // It should already be set, but double-check
      if (this.replayState && this.replayState.sessionId) {
        console.log(`[Orchestrator] Final replay state: sessionId=${this.replayState.sessionId}, url=${this.replayState.url || "none"}, actions=${this.replayState.actions.length}`);
      } else {
        console.log("[Orchestrator] No replay state to save");
      }
    }
  }
}
