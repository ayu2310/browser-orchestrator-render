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
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const taskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  status: taskStatusSchema,
  createdAt: z.number(),
  completedAt: z.number().optional(),
  duration: z.number().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
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
