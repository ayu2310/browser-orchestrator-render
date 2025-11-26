import { McpClient } from "./server/mcp-client.js";
import { Orchestrator } from "./server/orchestrator.js";

// Mock storage for testing
const mockLogs: any[] = [];
const mockStorage = {
  addLog: async (log: any) => {
    const logEntry = { ...log, id: `test-${Date.now()}` };
    mockLogs.push(logEntry);
    console.log(`[LOG ${log.level.toUpperCase()}] ${log.message}`);
    if (log.details?.screenshot) {
      console.log(`  └─ Screenshot captured (${log.details.screenshot.length} chars)`);
    }
    return logEntry;
  },
};

async function testMCPConnection() {
  console.log("\n=== Testing MCP Connection ===\n");
  
  const mcpClient = new McpClient({
    url: process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp",
    apiKey: process.env.MCP_API_KEY,
  });

  try {
    console.log("1. Testing connection...");
    await mcpClient.connect();
    console.log("   ✅ Connection successful");

    console.log("\n2. Testing listTools...");
    const tools = await mcpClient.listTools();
    console.log(`   ✅ Found ${tools.length} tools`);
    
    if (tools.length > 0) {
      console.log(`   Available tools: ${tools.slice(0, 5).map(t => t.name).join(", ")}${tools.length > 5 ? "..." : ""}`);
    } else {
      throw new Error("No tools available - connection may have failed");
    }

    console.log("\n3. Testing session creation...");
    const sessionId = await mcpClient.createSession();
    console.log(`   ✅ Session created: ${sessionId}`);

    console.log("\n4. Testing screenshot capture...");
    const screenshotResult = await mcpClient.callFunction({
      function: "browserbase_screenshot",
      arguments: { sessionId },
    });
    
    if (screenshotResult.screenshot) {
      console.log(`   ✅ Screenshot captured (${screenshotResult.screenshot.length} chars)`);
      console.log(`   Screenshot format: ${screenshotResult.screenshot.substring(0, 30)}...`);
    } else {
      console.log("   ⚠️  No screenshot in response");
    }

    await mcpClient.close();
    return { success: true, sessionId, tools };
  } catch (error) {
    console.error("   ❌ Error:", error instanceof Error ? error.message : error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function testComplexTask() {
  console.log("\n=== Testing Complex Task Execution ===\n");
  
  const mcpClient = new McpClient({
    url: process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp",
    apiKey: process.env.MCP_API_KEY,
  });

  const orchestrator = new Orchestrator({
    mcpClient,
    onLog: async (level, message, details) => {
      await mockStorage.addLog({
        taskId: "test-task",
        timestamp: Date.now(),
        level,
        message,
        details,
      });
    },
  });

  try {
    console.log("Test Task: Navigate to Wikipedia and find AI types");
    const testPrompt = "Navigate to https://en.wikipedia.org/wiki/Artificial_intelligence, find the section about types of AI, and list at least 3 different AI types mentioned on the page.";
    
    console.log(`\nExecuting: "${testPrompt}"\n`);
    
    const result = await orchestrator.execute(testPrompt);
    
    console.log("\n=== Execution Result ===");
    console.log(`Success: ${result.success}`);
    if (result.result) {
      console.log(`Result: ${result.result}`);
    }
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    console.log("\n=== Logs Summary ===");
    const logCounts = mockLogs.reduce((acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log("Log counts:", logCounts);
    
    const screenshots = mockLogs.filter(log => log.screenshot || (log.details && log.details.screenshot));
    console.log(`Screenshots captured: ${screenshots.length}`);
    if (screenshots.length > 0) {
      screenshots.forEach((log, i) => {
        const screenshot = log.screenshot || log.details?.screenshot;
        console.log(`  Screenshot ${i + 1}: ${screenshot ? screenshot.length + ' chars' : 'missing'}`);
      });
    }
    
    const replayState = orchestrator.getReplayState();
    if (replayState) {
      console.log("\n=== Replay State ===");
      console.log(`Session ID: ${replayState.sessionId}`);
      console.log(`URL: ${replayState.url || "Not set"}`);
      console.log(`Actions captured: ${replayState.actions.length}`);
    }

    return result;
  } catch (error) {
    console.error("\n❌ Task execution failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function testReplayFlow() {
  console.log("\n=== Testing Replay Flow ===\n");
  
  // First, execute a task to get replay state
  const mcpClient = new McpClient({
    url: process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp",
    apiKey: process.env.MCP_API_KEY,
  });

  const orchestrator = new Orchestrator({
    mcpClient,
    onLog: async (level, message, details) => {
      await mockStorage.addLog({
        taskId: "test-task",
        timestamp: Date.now(),
        level,
        message,
        details,
      });
    },
  });

  try {
    console.log("Step 1: Execute original task to capture replay state...");
    const testPrompt = "Navigate to https://example.com";
    const result = await orchestrator.execute(testPrompt);
    
    if (!result.success) {
      console.error("❌ Original task failed, cannot test replay");
      return { success: false, error: "Original task failed" };
    }

    const replayState = orchestrator.getReplayState();
    if (!replayState) {
      console.error("❌ No replay state captured");
      return { success: false, error: "No replay state" };
    }

    console.log("✅ Replay state captured:");
    console.log(`   Session ID: ${replayState.sessionId}`);
    console.log(`   URL: ${replayState.url || "none"}`);
    console.log(`   Actions: ${replayState.actions.length}`);

    // Now test deterministic replay (without Orchestrator)
    console.log("\nStep 2: Testing deterministic replay (no LLM)...");
    const replayMcpClient = new McpClient({
      url: process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp",
      apiKey: process.env.MCP_API_KEY,
    });

    const replayLogs: any[] = [];
    const replayLog = async (level: string, message: string) => {
      replayLogs.push({ level, message, timestamp: Date.now() });
      console.log(`[REPLAY ${level.toUpperCase()}] ${message}`);
    };

    await replayMcpClient.connect();
    await replayLog("info", `Replaying with session ${replayState.sessionId}...`);

    // Reuse session
    await replayMcpClient.createSession(replayState.sessionId);
    await replayLog("success", `Session reused: ${replayState.sessionId}`);

    // Navigate
    if (replayState.url) {
      await replayLog("info", `Navigating to ${replayState.url}...`);
      const navResult = await replayMcpClient.callFunction({
        function: "browserbase_stagehand_navigate",
        arguments: { url: replayState.url, sessionId: replayState.sessionId },
      });
      if (navResult.error) {
        throw new Error(`Navigation failed: ${navResult.error}`);
      }
      await replayLog("success", `Navigated to ${replayState.url}`);
    }

    // Execute actions
    for (const action of replayState.actions) {
      await replayLog("info", `Replaying action: ${action.function}...`);
      const actionResult = await replayMcpClient.callFunction({
        function: action.function,
        arguments: { ...action.arguments, sessionId: replayState.sessionId },
      });
      if (actionResult.error) {
        await replayLog("error", `Action failed: ${actionResult.error}`);
      } else {
        await replayLog("success", `Action completed`);
      }
    }

    await replayMcpClient.close();
    await replayLog("success", "Replay completed successfully");

    console.log("\n✅ Replay test passed!");
    console.log(`   Replay logs: ${replayLogs.length}`);
    return { success: true };
  } catch (error) {
    console.error("\n❌ Replay test failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function runTests() {
  console.log("🧪 Starting Local Test Suite\n");
  console.log("Environment:");
  console.log(`  MCP_SERVER_URL: ${process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp"}`);
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Not set"}`);
  console.log(`  MCP_API_KEY: ${process.env.MCP_API_KEY ? "✅ Set" : "⚠️  Not set (optional)"}`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("\n❌ OPENAI_API_KEY is required for testing!");
    console.log("Set it with: $env:OPENAI_API_KEY='your-key' (PowerShell) or export OPENAI_API_KEY='your-key' (Bash)");
    process.exit(1);
  }

  // Test 1: MCP Connection
  const connectionTest = await testMCPConnection();
  if (!connectionTest.success) {
    console.error("\n❌ MCP connection test failed. Cannot proceed with task test.");
    process.exit(1);
  }

  // Test 2: Complex Task
  const taskTest = await testComplexTask();

  // Test 3: Replay Flow (deterministic, no LLM)
  const replayTest = await testReplayFlow();

  // Summary
  console.log("\n=== Test Summary ===");
  console.log(`MCP Connection: ${connectionTest.success ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Task Execution: ${taskTest.success ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Replay Flow: ${replayTest.success ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Total Logs: ${mockLogs.length}`);
  console.log(`Screenshots: ${mockLogs.filter(l => l.screenshot).length}`);

  if (connectionTest.success && taskTest.success && replayTest.success) {
    console.log("\n✅ All tests passed!");
    process.exit(0);
  } else {
    console.log("\n❌ Some tests failed!");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

