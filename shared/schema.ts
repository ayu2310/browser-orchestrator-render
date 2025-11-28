import { z } from "zod";

export const taskStatusSchema = z.enum(["idle", "running", "completed", "failed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const logLevelSchema = z.enum(["info", "success", "error", "warning"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  timestamp: z.number(),
  level: logLevelSchema,
  message: z.string(),
  details: z.any().optional(),
  screenshot: z.string().optional(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const replayStateSchema = z.object({
  sessionId: z.string(),
  url: z.string().optional(), // First/initial URL (for backward compatibility)
  pages: z.array(z.string()).optional(), // All pages navigated to in order (deprecated, use actions)
  actions: z.array(z.object({
    function: z.string(),
    arguments: z.record(z.any()),
  })), // All function calls in exact execution order (navigate, act, extract, screenshot, etc.)
});
export type ReplayState = z.infer<typeof replayStateSchema>;

export const taskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  status: taskStatusSchema,
  createdAt: z.number(),
  completedAt: z.number().optional(),
  duration: z.number().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
  replayState: replayStateSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const insertTaskSchema = taskSchema.pick({
  prompt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;

export const mcpFunctionCallSchema = z.object({
  function: z.string(),
  arguments: z.record(z.any()),
  result: z.any().optional(),
  error: z.string().optional(),
});
export type McpFunctionCall = z.infer<typeof mcpFunctionCallSchema>;
