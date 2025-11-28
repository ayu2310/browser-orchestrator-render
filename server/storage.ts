import { type Task, type LogEntry } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createTask(prompt: string): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined>;
  getAllTasks(): Promise<Task[]>;
  getCurrentTask(): Promise<Task | null>;
  
  addLog(log: Omit<LogEntry, "id">): Promise<LogEntry>;
  getTaskLogs(taskId: string): Promise<LogEntry[]>;
  deleteLogsForTask(taskId: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private tasks: Map<string, Task>;
  private logs: Map<string, LogEntry>;
  private currentTaskId: string | null = null;

  constructor() {
    this.tasks = new Map();
    this.logs = new Map();
  }

  async createTask(prompt: string): Promise<Task> {
    const id = randomUUID();
    const task: Task = {
      id,
      prompt,
      status: "running",
      createdAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.currentTaskId = id;
    return task;
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updated = { ...task, ...updates };
    this.tasks.set(id, updated);
    
    if (updated.status === "completed" || updated.status === "failed") {
      this.currentTaskId = null;
    }
    
    return updated;
  }

  async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getCurrentTask(): Promise<Task | null> {
    if (!this.currentTaskId) return null;
    return this.tasks.get(this.currentTaskId) || null;
  }

  async addLog(log: Omit<LogEntry, "id">): Promise<LogEntry> {
    const id = randomUUID();
    // Extract screenshot from details if present
    let screenshot: string | undefined = undefined;
    if (log.details && typeof log.details === 'object' && 'screenshot' in log.details) {
      screenshot = (log.details as any).screenshot;
    }
    
    const logEntry: LogEntry = { 
      ...log, 
      id,
      screenshot,
      details: log.details && typeof log.details === 'object' && 'screenshot' in log.details 
        ? Object.fromEntries(Object.entries(log.details as any).filter(([k]) => k !== 'screenshot'))
        : log.details,
    };
    this.logs.set(id, logEntry);
    return logEntry;
  }

  async getTaskLogs(taskId: string): Promise<LogEntry[]> {
    return Array.from(this.logs.values())
      .filter((log) => log.taskId === taskId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async deleteLogsForTask(taskId: string): Promise<void> {
    const logIdsToDelete: string[] = [];
    // Use Array.from to avoid downlevelIteration requirement
    Array.from(this.logs.entries()).forEach(([logId, log]) => {
      if (log.taskId === taskId) {
        logIdsToDelete.push(logId);
      }
    });
    for (const logId of logIdsToDelete) {
      this.logs.delete(logId);
    }
  }
}

export const storage = new MemStorage();
