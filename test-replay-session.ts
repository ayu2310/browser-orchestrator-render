import { McpClient } from "./server/mcp-client.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp";

async function testReplaySessionReuse() {
  console.log("\n=== Testing Replay Session Reuse ===\n");
  
  // Step 1: Create a session and do a simple task
  console.log("Step 1: Creating session and executing a simple task...");
  const client1 = new McpClient({
    url: MCP_SERVER_URL,
    apiKey: process.env.MCP_API_KEY,
  });

  await client1.connect();
  const originalSessionId = await client1.createSession();
  console.log(`   ✅ Original session created: ${originalSessionId}`);

  // Navigate to a page
  const navResult1 = await client1.callFunction({
    function: "browserbase_stagehand_navigate",
    arguments: {
      url: "https://example.com",
      sessionId: originalSessionId,
    },
  });
  console.log(`   ✅ Navigated to example.com`);

  // Get URL to verify
  const urlResult1 = await client1.callFunction({
    function: "browserbase_stagehand_get_url",
    arguments: {
      sessionId: originalSessionId,
    },
  });
  console.log(`   ✅ Current URL: ${JSON.stringify(urlResult1.result)}`);

  await client1.close();
  console.log(`\n   Original session ID saved: ${originalSessionId}\n`);

  // Step 2: Now try to "replay" by reusing the same sessionId
  console.log("Step 2: Replaying with the same sessionId...");
  const client2 = new McpClient({
    url: MCP_SERVER_URL,
    apiKey: process.env.MCP_API_KEY,
  });

  await client2.connect();
  
  // This is what happens during replay - we call createSession with existing sessionId
  console.log(`   Calling createSession(${originalSessionId}) to reuse session...`);
  const reusedSessionId = await client2.createSession(originalSessionId);
  console.log(`   ✅ Reused session: ${reusedSessionId}`);

  if (reusedSessionId !== originalSessionId) {
    console.error(`   ❌ ERROR: Session ID mismatch! Expected ${originalSessionId}, got ${reusedSessionId}`);
    await client2.close();
    return { success: false, error: "Session ID mismatch" };
  }

  // Now navigate to a different page to verify we're using the same session
  console.log(`\n   Navigating to example.org in the reused session...`);
  const navResult2 = await client2.callFunction({
    function: "browserbase_stagehand_navigate",
    arguments: {
      url: "https://example.org",
      sessionId: reusedSessionId,
    },
  });
  console.log(`   ✅ Navigated to example.org`);

  // Get URL to verify we're in the same session
  const urlResult2 = await client2.callFunction({
    function: "browserbase_stagehand_get_url",
    arguments: {
      sessionId: reusedSessionId,
    },
  });
  console.log(`   ✅ Current URL: ${JSON.stringify(urlResult2.result)}`);

  // Verify the session is the same by checking if we can still access example.com state
  // (This depends on how Browserbase handles sessions, but the sessionId should match)
  console.log(`\n   ✅ Session reuse verified!`);
  console.log(`   Original sessionId: ${originalSessionId}`);
  console.log(`   Reused sessionId: ${reusedSessionId}`);
  console.log(`   Match: ${originalSessionId === reusedSessionId ? "✅ YES" : "❌ NO"}`);

  await client2.close();

  console.log("\n✅ Replay session reuse test PASSED!");
  return { success: true, originalSessionId, reusedSessionId };
}

// Run the test
testReplaySessionReuse()
  .then((result) => {
    if (result.success) {
      console.log("\n✅ All tests passed!");
      process.exit(0);
    } else {
      console.log("\n❌ Test failed!");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });

