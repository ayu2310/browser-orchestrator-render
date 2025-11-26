import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { McpClient } from "./mcp-client";
import { Orchestrator } from "./orchestrator";
import { insertTaskSchema, type LogEntry } from "@shared/schema";

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
        try {
          const result = await orchestrator.execute(prompt);
          
          // Get replay state before updating task
          const replayState = orchestrator.getReplayState();
          
          if (result.success) {
            await storage.updateTask(task.id, {
              status: "completed",
              completedAt: Date.now(),
              duration: Date.now() - task.createdAt,
              result: result.result,
              replayState: replayState || undefined,
            });
          } else {
            await storage.updateTask(task.id, {
              status: "failed",
              completedAt: Date.now(),
              duration: Date.now() - task.createdAt,
              error: result.error,
              replayState: replayState || undefined,
            });
          }
        } catch (error) {
          const replayState = orchestrator.getReplayState();
          await storage.updateTask(task.id, {
            status: "failed",
            completedAt: Date.now(),
            duration: Date.now() - task.createdAt,
            error: error instanceof Error ? error.message : "Task execution failed",
            replayState: replayState || undefined,
          });
        }
        
        currentOrchestrator = null;
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

      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          message: "OpenAI API key not configured. Please add your OPENAI_API_KEY to secrets.",
        });
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

      const orchestrator = new Orchestrator({
        mcpClient,
        onLog: async (level, message, details) => {
          const log = await storage.addLog({
            taskId: replayTask.id,
            timestamp: Date.now(),
            level,
            message,
            details,
          });
          broadcastLog(log);
        },
      });

      currentOrchestrator = orchestrator;

      res.json(replayTask);

      setImmediate(async () => {
        try {
          // Replay: use existing session, navigate to URL, execute actions
          await orchestrator.initialize();
          await orchestrator.log("info", `Replaying task with session ${sessionId}...`);

          // Reuse the session
          await mcpClient.createSession(sessionId);
          await orchestrator.log("success", `Reusing browser session: ${sessionId}`);

          // Navigate to the cached URL if available
          if (url) {
            await orchestrator.log("info", `Navigating to ${url}...`);
            const navigateResult = await mcpClient.callFunction({
              function: "browserbase_stagehand_navigate",
              arguments: { url, sessionId },
            });
            if (navigateResult.error) {
              throw new Error(`Navigation failed: ${navigateResult.error}`);
            }
            await orchestrator.log("success", `Navigated to ${url}`);
          }

          // Execute all cached actions
          for (const action of actions) {
            await orchestrator.log("info", `Replaying action: ${action.function}...`);
            const actionResult = await mcpClient.callFunction({
              function: action.function,
              arguments: { ...action.arguments, sessionId },
            });
            if (actionResult.error) {
              await orchestrator.log("error", `Action failed: ${actionResult.error}`);
            } else {
              await orchestrator.log("success", `Action completed: ${action.function}`);
            }
          }

          await storage.updateTask(replayTask.id, {
            status: "completed",
            completedAt: Date.now(),
            duration: Date.now() - replayTask.createdAt,
            result: "Replay completed successfully",
          });

          // Clean up replay state from original task
          await storage.updateTask(task.id, {
            replayState: undefined,
          });
        } catch (error) {
          await storage.updateTask(replayTask.id, {
            status: "failed",
            completedAt: Date.now(),
            duration: Date.now() - replayTask.createdAt,
            error: error instanceof Error ? error.message : "Replay failed",
          });
        } finally {
          // Close the session
          await mcpClient.close();
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
