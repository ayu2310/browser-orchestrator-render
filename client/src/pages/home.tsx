import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  Play, 
  Square, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Terminal,
  Info,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  X
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Task, LogEntry } from "@shared/schema";
import { useEffect, useRef } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null);
  const [executionLogs, setExecutionLogs] = useState<LogEntry[]>([]);
  const [replayLogs, setReplayLogs] = useState<LogEntry[]>([]);
  const [originalTaskId, setOriginalTaskId] = useState<string | null>(null);
  const [replayTaskId, setReplayTaskId] = useState<string | null>(null);
  const executionLogsEndRef = useRef<HTMLDivElement>(null);
  const replayLogsEndRef = useRef<HTMLDivElement>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const replayTaskIdRef = useRef<string | null>(null);

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: 2000, // Refetch every 2 seconds to catch task updates
  });

  const { data: currentTask } = useQuery<Task | null>({
    queryKey: ["/api/tasks/current"],
    refetchInterval: currentTaskId ? 1000 : false,
  });

  const { data: historicalLogs = [] } = useQuery<LogEntry[]>({
    queryKey: ["/api/tasks", selectedHistoryTaskId, "logs"],
    queryFn: async () => {
      if (!selectedHistoryTaskId) return [];
      const response = await fetch(`/api/tasks/${selectedHistoryTaskId}/logs`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
    enabled: !!selectedHistoryTaskId && !currentTaskId,
  });

  const executeMutation = useMutation({
    mutationFn: async (taskPrompt: string) => {
      const response = await apiRequest("POST", "/api/tasks/execute", { prompt: taskPrompt });
      return await response.json();
    },
    onSuccess: (data: Task) => {
      setCurrentTaskId(data.id);
      currentTaskIdRef.current = data.id;
      setSelectedHistoryTaskId(null);
      setPrompt("");
      setExecutionLogs([]);
      setReplayLogs([]);
      setOriginalTaskId(null);
      setReplayTaskId(null);
      replayTaskIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to execute task";
      setCurrentTaskId(null);
      currentTaskIdRef.current = null;
      setSelectedHistoryTaskId(null);
      setExecutionLogs([{
        id: "error-" + Date.now(),
        taskId: "error",
        timestamp: Date.now(),
        level: "error",
        message,
      }]);
      setReplayLogs([]);
      setOriginalTaskId(null);
      setReplayTaskId(null);
      replayTaskIdRef.current = null;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks/cancel", {}),
    onSuccess: () => {
      setCurrentTaskId(null);
      currentTaskIdRef.current = null;
      setReplayTaskId(null);
      replayTaskIdRef.current = null;
      setOriginalTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
    },
  });

  const replayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/replay`, {});
      return await response.json();
    },
    onSuccess: async (data: Task, variables: string) => {
      // Load original task logs for execution logs section
      const originalTaskId = variables;
      setOriginalTaskId(originalTaskId);
      
      // Set replay task ID FIRST before setting currentTaskId
      setReplayTaskId(data.id);
      replayTaskIdRef.current = data.id;
      
      try {
        const logsResponse = await fetch(`/api/tasks/${originalTaskId}/logs`);
        if (logsResponse.ok) {
          const originalLogs = await logsResponse.json();
          setExecutionLogs(originalLogs);
        }
      } catch (error) {
        console.error("Failed to load original task logs:", error);
      }
      
      // Clear replay logs for new replay
      setReplayLogs([]);
      
      // Set current task ID to replay task ID (so WebSocket connects)
      // But WebSocket handler will use replayTaskIdRef to distinguish replay logs
      setCurrentTaskId(data.id);
      currentTaskIdRef.current = data.id;
      setSelectedHistoryTaskId(null);
      setPrompt("");
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
    },
  });

  const cancelReplayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/cancel-replay`, {});
      return await response.json();
    },
    onSuccess: () => {
      setReplayLogs([]);
      setReplayTaskId(null);
      replayTaskIdRef.current = null;
      setOriginalTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
    },
  });

  useEffect(() => {
    if (currentTask?.status === "completed" || currentTask?.status === "failed") {
      // Invalidate queries to refresh task list and current task
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
      
      // After a delay, clear current task and select it in history
      // But only if it's not a replay task
      if (!currentTask.prompt.startsWith("Replay: ")) {
        setTimeout(() => {
          setCurrentTaskId(null);
          currentTaskIdRef.current = null;
          setSelectedHistoryTaskId(currentTask.id);
          setReplayTaskId(null);
          replayTaskIdRef.current = null;
          setOriginalTaskId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }, 3000); // Increased delay to ensure replay button is visible
      } else {
        // If it's a replay task that completed, clear replay state
        setTimeout(() => {
          setCurrentTaskId(null);
          currentTaskIdRef.current = null;
          setReplayTaskId(null);
          replayTaskIdRef.current = null;
          setOriginalTaskId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }, 2000);
      }
    }
  }, [currentTask?.status, currentTask?.id, currentTask?.replayState, currentTask?.prompt]);

  useEffect(() => {
    if (selectedHistoryTaskId && !currentTaskId) {
      // Check if the selected task is a replay task (starts with "Replay: ")
      const selectedTask = tasks.find(t => t.id === selectedHistoryTaskId);
      const isReplayTask = selectedTask?.prompt?.startsWith("Replay: ");
      
      if (isReplayTask) {
        // For replay tasks, show logs in Replay Logs section
        setReplayLogs(historicalLogs);
        setExecutionLogs([]);
        setReplayTaskId(selectedHistoryTaskId);
        replayTaskIdRef.current = selectedHistoryTaskId;
        // Find the original task if we can (look for task with matching prompt without "Replay: " prefix)
        const originalPrompt = selectedTask?.prompt?.replace(/^Replay: /, "");
        const originalTask = tasks.find(t => t.prompt === originalPrompt && !t.prompt.startsWith("Replay: "));
        setOriginalTaskId(originalTask?.id || null);
      } else {
        // For regular tasks, show logs in Execution Logs section
        setExecutionLogs(historicalLogs);
        setReplayLogs([]);
        setOriginalTaskId(null);
        setReplayTaskId(null);
        replayTaskIdRef.current = null;
      }
    } else if (!selectedHistoryTaskId && !currentTaskId) {
      // Clear logs when no task is selected
      setExecutionLogs([]);
      setReplayLogs([]);
      setOriginalTaskId(null);
      setReplayTaskId(null);
      replayTaskIdRef.current = null;
    }
  }, [historicalLogs, selectedHistoryTaskId, currentTaskId, tasks]);

  useEffect(() => {
    executionLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [executionLogs]);

  useEffect(() => {
    replayLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replayLogs]);

  // WebSocket for logs (listens for both execution and replay logs)
  useEffect(() => {
    // Update refs whenever state changes
    currentTaskIdRef.current = currentTaskId;
    replayTaskIdRef.current = replayTaskId;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "log") {
          // Use refs to get latest values (avoid stale closure)
          const currentReplayTaskId = replayTaskIdRef.current;
          const currentTaskIdValue = currentTaskIdRef.current;
          
          // Check if this is a replay log (must check first, before execution log check)
          if (currentReplayTaskId && data.taskId === currentReplayTaskId) {
            // Add to replay logs
            setReplayLogs((prev) => [...prev, data.log]);
          } 
          // Check if this is an execution log (current task, but NOT the replay task)
          else if (currentTaskIdValue && data.taskId === currentTaskIdValue && data.taskId !== currentReplayTaskId) {
            // Add to execution logs
            setExecutionLogs((prev) => [...prev, data.log]);
          }
        }
      } catch (error) {
        console.error("[UI] Error parsing WebSocket log message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[UI] WebSocket error in logs connection:", error);
    };

    return () => ws.close();
  }, [currentTaskId, replayTaskId]);

  // Global WebSocket for task updates (always connected)
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "task_update") {
          // Task was updated, refresh the tasks list
          console.log("[UI] Task update received, refreshing tasks list");
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
        }
      } catch (error) {
        console.error("[UI] Error parsing WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[UI] WebSocket error:", error);
    };

    return () => ws.close();
  }, []);

  const handleExecute = () => {
    if (prompt.trim()) {
      executeMutation.mutate(prompt.trim());
    }
  };

  const isExecuting = currentTask?.status === "running";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">AI-powered browser automation agent</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-status-online" data-testid="status-connection" />
            <span className="text-sm text-muted-foreground">Connected</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Task Prompt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Example: Navigate to google.com and search for 'OpenAI GPT-5'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-32 resize-none"
                  disabled={isExecuting}
                  data-testid="input-prompt"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      handleExecute();
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {prompt.length} characters • Press Cmd/Ctrl+Enter to execute
                  </span>
                  <div className="flex gap-2">
                    {isExecuting && (
                      <Button
                        variant="destructive"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                        data-testid="button-cancel"
                      >
                        <Square className="w-4 h-4" />
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleExecute}
                      disabled={!prompt.trim() || isExecuting}
                      data-testid="button-execute"
                    >
                      <Play className="w-4 h-4" />
                      Execute Task
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {currentTask && (
              <Card data-testid="card-execution-status">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Execution Status</CardTitle>
                    <StatusBadge status={currentTask.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">Task:</p>
                    <p className="text-sm text-muted-foreground" data-testid="text-current-prompt">
                      {currentTask.prompt}
                    </p>
                  </div>
                  {currentTask.status === "running" && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Processing...</span>
                        <span className="text-muted-foreground" data-testid="text-elapsed-time">
                          {Math.floor((Date.now() - currentTask.createdAt) / 1000)}s
                        </span>
                      </div>
                      <Progress value={undefined} className="w-full" data-testid="progress-execution" />
                    </div>
                  )}
                  {currentTask.status === "completed" && currentTask.duration && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Completed in</span>
                      <span className="font-medium" data-testid="text-completion-time">
                        {(currentTask.duration / 1000).toFixed(2)}s
                      </span>
                    </div>
                  )}
                  {currentTask.status === "failed" && currentTask.error && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md" data-testid="error-message">
                      <p className="text-sm text-destructive">{currentTask.error}</p>
                    </div>
                  )}
                  {(currentTask.status === "completed" || currentTask.status === "failed") && currentTask.replayState && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium mb-3">Replay Session</p>
                      <div className="flex gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => replayMutation.mutate(currentTask.id)}
                          disabled={replayMutation.isPending || isExecuting}
                          data-testid="button-replay"
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Replay
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cancelReplayMutation.mutate(currentTask.id)}
                          disabled={cancelReplayMutation.isPending || isExecuting}
                          data-testid="button-cancel-replay"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5" />
                  <CardTitle className="text-lg">Execution Logs</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-96 w-full rounded-md border bg-muted/30 p-4">
                  {executionLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No logs yet. Execute a task to see logs here.
                    </div>
                  ) : (
                    <div className="space-y-2 font-mono text-sm">
                      {executionLogs.map((log) => (
                        <LogLine key={log.id} log={log} />
                      ))}
                      <div ref={executionLogsEndRef} />
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {(replayTaskId || (selectedHistoryTaskId && tasks.find(t => t.id === selectedHistoryTaskId)?.prompt?.startsWith("Replay: "))) && (
              <Card className="border-2 border-primary/20 bg-primary/5">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-primary" />
                    <CardTitle className="text-lg text-primary font-semibold">Replay Logs</CardTitle>
                    {replayLogs.length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {replayLogs.length} entries
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96 w-full rounded-md border bg-muted/30 p-4">
                    {replayLogs.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        {replayTaskId ? "Replay in progress... Logs will appear here." : "No replay logs available."}
                      </div>
                    ) : (
                      <div className="space-y-2 font-mono text-sm">
                        {replayLogs.map((log) => (
                          <LogLine key={log.id} log={log} />
                        ))}
                        <div ref={replayLogsEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-lg">Task History</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[calc(100vh-200px)]">
                  {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center">
                      <Clock className="w-8 h-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No tasks yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tasks.map((task) => (
                        <TaskHistoryItem 
                          key={task.id} 
                          task={task}
                          isSelected={selectedHistoryTaskId === task.id}
                          onSelect={() => {
                            if (!currentTaskId) {
                              setSelectedHistoryTaskId(
                                selectedHistoryTaskId === task.id ? null : task.id
                              );
                            }
                          }}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const config = {
    idle: { label: "Idle", variant: "secondary" as const, icon: Clock },
    running: { label: "Running", variant: "default" as const, icon: Play },
    completed: { label: "Completed", variant: "default" as const, icon: CheckCircle2 },
    failed: { label: "Failed", variant: "destructive" as const, icon: XCircle },
  };

  const { label, variant, icon: Icon } = config[status];

  return (
    <Badge variant={variant} className="gap-1" data-testid={`badge-status-${status}`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const iconMap = {
    info: Info,
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
  };

  const colorMap = {
    info: "text-muted-foreground",
    success: "text-status-online",
    error: "text-destructive",
    warning: "text-status-away",
  };

  const Icon = iconMap[log.level];
  const color = colorMap[log.level];

  const timestamp = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const [showScreenshot, setShowScreenshot] = useState(false);

  return (
    <div className="flex flex-col gap-2 items-start" data-testid={`log-${log.level}`}>
      <div className="flex gap-2 items-start w-full">
        <span className="text-xs text-muted-foreground shrink-0">{timestamp}</span>
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} />
        <span className={`text-xs ${color} break-all flex-1`}>{log.message}</span>
        {log.screenshot && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-6 px-2 shrink-0"
            onClick={() => setShowScreenshot(!showScreenshot)}
            data-testid={`button-screenshot-${log.id}`}
          >
            {showScreenshot ? "Hide" : "View"} Screenshot
          </Button>
        )}
      </div>
      {showScreenshot && log.screenshot && (
        <div className="w-full mt-2 rounded-md border overflow-hidden bg-black/5 dark:bg-white/5">
          <img
            src={log.screenshot}
            alt="Browser screenshot"
            className="w-full h-auto max-h-[600px] object-contain"
            data-testid={`img-screenshot-${log.id}`}
            onError={(e) => {
              console.error("Failed to load screenshot:", log.screenshot?.substring(0, 50));
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}
    </div>
  );
}

function TaskHistoryItem({ 
  task, 
  isSelected, 
  onSelect 
}: { 
  task: Task;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const replayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/replay`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/current"] });
    },
  });

  const cancelReplayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/cancel-replay`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    replayMutation.mutate(task.id);
  };

  const handleCancelReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelReplayMutation.mutate(task.id);
  };

  return (
    <Card 
      className={`hover-elevate transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={onSelect}
      data-testid={`card-task-${task.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-medium line-clamp-2 cursor-pointer" data-testid={`text-task-prompt-${task.id}`}>
            {task.prompt}
          </p>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span data-testid={`text-task-date-${task.id}`}>
            {new Date(task.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {task.duration && (
            <span data-testid={`text-task-duration-${task.id}`}>
              {(task.duration / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {(task.status === "completed" || task.status === "failed") && task.replayState && (
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={handleReplay}
              disabled={replayMutation.isPending}
              data-testid={`button-replay-${task.id}`}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Replay
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelReplay}
              disabled={cancelReplayMutation.isPending}
              data-testid={`button-cancel-replay-${task.id}`}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
