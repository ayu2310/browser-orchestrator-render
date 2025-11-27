import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { McpClient } from "./mcp-client";
import { Orchestrator } from "./orchestrator";
import { insertTaskSchema, type LogEntry, type Task } from "@shared/schema";

const connectedClients = new Set<WebSocket>();
let currentOrchestrator: Orchestrator | null = null;

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    connectedClients.add(ws);
    
    ws.on("close", () => {
      connectedClients.delete(ws);
    });
  });

  function broadcastLog(log: LogEntry) {
    const message = JSON.stringify({ type: "log", log, taskId: log.taskId });
    connectedClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  function broadcastTaskUpdate(task: Task) {
    const message = JSON.stringify({ type: "task_update", data: task });
    connectedClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  app.get("/api/tasks", async (_req, res) => {
    const tasks = await storage.getAllTasks();
    res.json(tasks);
  });

  app.get("/api/tasks/current", async (_req, res) => {
    const task = await storage.getCurrentTask();
    res.json(task);
  });

  app.post("/api/tasks/execute", async (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          message: "OpenAI API key not configured. Please add your OPENAI_API_KEY to secrets.",
        });
      }

      const { prompt } = insertTaskSchema.parse(req.body);

      const task = await storage.createTask(prompt);

      const mcpServerUrl = process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp";
      console.log(`[Routes] Using MCP server URL: ${mcpServerUrl}`);
      
      const mcpClient = new McpClient({
        url: mcpServerUrl,
        apiKey: process.env.MCP_API_KEY,
      });

      const orchestrator = new Orchestrator({
        mcpClient,
        onLog: async (level, message, details) => {
          const log = await storage.addLog({
            taskId: task.id,
            timestamp: Date.now(),
            level,
            message,
            details,
          });
          broadcastLog(log);
        },
      });

      currentOrchestrator = orchestrator;

      res.json(task);

      setImmediate(async () => {
        let result: { success: boolean; result?: any; error?: string } | null = null;
        try {
          result = await orchestrator.execute(prompt);
          console.log(`[Routes] Task ${task.id} execute() returned:`, result);
        } catch (error) {
          console.error(`[Routes] Task ${task.id} execution error:`, error);
          result = {
            success: false,
            error: error instanceof Error ? error.message : "Task execution failed",
          };
        }
        
        // Get replay state AFTER execution completes (orchestrator still has it)
        const replayState = orchestrator.getReplayState();
        console.log(`[Routes] Task ${task.id} execution completed, replayState:`, replayState ? {
          sessionId: replayState.sessionId,
          url: replayState.url,
          actionsCount: replayState.actions.length
        } : "null");
        
          // Update task status with replayState - CRITICAL: This must happen
          try {
            let updatedTask: Task | undefined;
            if (result && result.success) {
              updatedTask = await storage.updateTask(task.id, {
                status: "completed",
                completedAt: Date.now(),
                duration: Date.now() - task.createdAt,
                result: result.result,
                replayState: replayState || undefined,
              });
              console.log(`[Routes] ✅ Task ${task.id} updated to completed`);
              console.log(`[Routes] ReplayState saved:`, updatedTask?.replayState ? {
                sessionId: updatedTask.replayState.sessionId,
                url: updatedTask.replayState.url,
                actionsCount: updatedTask.replayState.actions.length
              } : "none");
            } else {
              updatedTask = await storage.updateTask(task.id, {
                status: "failed",
                completedAt: Date.now(),
                duration: Date.now() - task.createdAt,
                error: result?.error || "Task execution failed",
                replayState: replayState || undefined,
              });
              console.log(`[Routes] ❌ Task ${task.id} updated to failed`);
              console.log(`[Routes] ReplayState saved:`, updatedTask?.replayState ? "yes" : "no");
            }
            
            // Broadcast task update to connected clients
            if (updatedTask) {
              console.log(`[Routes] Broadcasting task update for ${updatedTask.id}, replayState exists:`, !!updatedTask.replayState);
              broadcastTaskUpdate(updatedTask);
            }
          } catch (updateError) {
            console.error(`[Routes] CRITICAL: Failed to update task ${task.id} status:`, updateError);
          } finally {
            currentOrchestrator = null;
          }
      });
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to execute task",
      });
    }
  });

  app.post("/api/tasks/cancel", async (_req, res) => {
    if (currentOrchestrator) {
      currentOrchestrator.cancel();
      const currentTask = await storage.getCurrentTask();
      if (currentTask) {
        await storage.updateTask(currentTask.id, {
          status: "failed",
          completedAt: Date.now(),
          duration: Date.now() - currentTask.createdAt,
          error: "Cancelled by user",
        });
      }
    }
    res.json({ success: true });
  });

  app.get("/api/tasks/:id/logs", async (req, res) => {
    const logs = await storage.getTaskLogs(req.params.id);
    res.json(logs);
  });

  app.post("/api/tasks/:id/replay", async (req, res) => {
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      if (!task.replayState) {
        return res.status(400).json({ message: "No replay state available for this task" });
      }

      const { sessionId, url, actions } = task.replayState;

      // Create a new task for the replay
      const replayTask = await storage.createTask(`Replay: ${task.prompt}`);

      const mcpServerUrl = process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp";
      console.log(`[Routes] Using MCP server URL for replay: ${mcpServerUrl}`);
      
      const mcpClient = new McpClient({
        url: mcpServerUrl,
        apiKey: process.env.MCP_API_KEY,
      });

      // Simple logging function for deterministic replay (no Orchestrator needed)
      const log = async (level: "info" | "success" | "error" | "warning", message: string, details?: any) => {
        const logEntry = await storage.addLog({
          taskId: replayTask.id,
          timestamp: Date.now(),
          level,
          message,
          details,
        });
        broadcastLog(logEntry);
      };

      // Set replay task as current task so WebSocket can route logs correctly
      await storage.updateTask(replayTask.id, { status: "running" });
      
      res.json(replayTask);

      setImmediate(async () => {
        try {
          // Connect MCP client
          await mcpClient.connect();
          await log("info", `Replaying task with session ${sessionId}...`);

          // Reuse the session (deterministic - no new session creation)
          await mcpClient.createSession(sessionId);
          await log("success", `Reusing browser session: ${sessionId}`);

          // Navigate to the cached URL if available
          if (url) {
            await log("info", `Navigating to ${url}...`);
            const navigateResult = await mcpClient.callFunction({
              function: "browserbase_stagehand_navigate",
              arguments: { url, sessionId },
            });
            if (navigateResult.error) {
              throw new Error(`Navigation failed: ${navigateResult.error}`);
            }
            await log("success", `Navigated to ${url}`);
            
            // Take screenshot after navigation
            await log("info", "Taking screenshot after navigation...");
            const screenshotResult = await mcpClient.callFunction({
              function: "browserbase_screenshot",
              arguments: { sessionId },
            });
            if (!screenshotResult.error && screenshotResult.screenshot) {
              await log("info", "Screenshot captured", { screenshot: screenshotResult.screenshot });
            } else {
              await log("warning", "Failed to capture screenshot after navigation");
            }
          }

          // Execute all cached actions deterministically
          for (const action of actions) {
            // Clean function name for UI display
            const cleanFunctionName = action.function
              .replace(/^browserbase_/i, "")
              .replace(/^stagehand_/i, "")
              .replace(/_/g, " ");
            
            await log("info", `Replaying action: ${cleanFunctionName}...`);
            const actionResult = await mcpClient.callFunction({
              function: action.function,
              arguments: { ...action.arguments, sessionId },
            });
            if (actionResult.error) {
              await log("error", `Action failed: ${actionResult.error}`);
            } else {
              await log("success", `${cleanFunctionName} completed successfully`);
              
              // Take screenshot after action if it's an act function
              if (action.function === "browserbase_stagehand_act") {
                await log("info", "Taking screenshot after action...");
                const screenshotResult = await mcpClient.callFunction({
                  function: "browserbase_screenshot",
                  arguments: { sessionId },
                });
                if (!screenshotResult.error && screenshotResult.screenshot) {
                  await log("info", "Screenshot captured", { screenshot: screenshotResult.screenshot });
                }
              }
            }
          }

          await log("info", "Closing browser session...");
          await mcpClient.close();
          await log("success", "Replay completed successfully");

          await storage.updateTask(replayTask.id, {
            status: "completed",
            completedAt: Date.now(),
            duration: Date.now() - replayTask.createdAt,
            result: "Replay completed successfully",
          });

          // Clean up replay state from original task (free memory)
          await storage.updateTask(task.id, {
            replayState: undefined,
          });
          console.log(`[Routes] Replay completed, cleaned up replayState from task ${task.id}`);
        } catch (error) {
          await log("error", `Replay failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          await storage.updateTask(replayTask.id, {
            status: "failed",
            completedAt: Date.now(),
            duration: Date.now() - replayTask.createdAt,
            error: error instanceof Error ? error.message : "Replay failed",
          });
        } finally {
          // Close the session and reset orchestrator
          try {
            await mcpClient.close();
          } catch (closeError) {
            console.error("[Routes] Error closing MCP client:", closeError);
          }
          currentOrchestrator = null;
        }
      });
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to replay task",
      });
    }
  });

  app.post("/api/tasks/:id/cancel-replay", async (req, res) => {
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Clean up replay state
      await storage.updateTask(task.id, {
        replayState: undefined,
      });

      res.json({ success: true });
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to cancel replay",
      });
    }
  });

  return httpServer;
}
