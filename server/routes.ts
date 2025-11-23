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

      const mcpClient = new McpClient({
        url: process.env.MCP_SERVER_URL || "http://localhost:3001",
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
          
          if (result.success) {
            await storage.updateTask(task.id, {
              status: "completed",
              completedAt: Date.now(),
              duration: Date.now() - task.createdAt,
              result: result.result,
            });
          } else {
            await storage.updateTask(task.id, {
              status: "failed",
              completedAt: Date.now(),
              duration: Date.now() - task.createdAt,
              error: result.error,
            });
          }
        } catch (error) {
          await storage.updateTask(task.id, {
            status: "failed",
            completedAt: Date.now(),
            duration: Date.now() - task.createdAt,
            error: error instanceof Error ? error.message : "Task execution failed",
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

  return httpServer;
}
