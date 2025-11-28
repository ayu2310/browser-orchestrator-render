import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp-browser-automation-render.onrender.com/api/mcp";

function extractSessionId(content: any[]): string | null {
  if (!Array.isArray(content)) return null;
  
  for (const item of content) {
    if (item.type === "text" && item.text) {
      const match = item.text.match(/sessions\/([a-f0-9-]+)/i);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}

async function testSessionReuse() {
  console.log("\n=== Testing Session Reuse ===\n");
  
  const client = new Client({
    name: "session-reuse-test",
    version: "1.0.0",
  });

  try {
    // Connect to MCP server
    console.log("1. Connecting to MCP server...");
    const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL));
    await client.connect(transport);
    console.log("   ✅ Connected");

    // Create a new session
    console.log("\n2. Creating new session...");
    const createResult = await client.callTool({
      name: "browserbase_session_create",
      arguments: {},
    });
    
    const sessionId = extractSessionId((createResult.content as any[]) || []);
    if (!sessionId) {
      throw new Error("Failed to extract sessionId from create response");
    }
    console.log(`   ✅ Session created: ${sessionId}`);

    // Navigate to a page
    console.log("\n3. Navigating to example.com with sessionId...");
    const navResult = await client.callTool({
      name: "browserbase_stagehand_navigate",
      arguments: {
        url: "https://example.com",
        sessionId: sessionId,
      },
    });
    console.log("   ✅ Navigation completed");
    console.log(`   Response: ${JSON.stringify(navResult.content).substring(0, 100)}...`);

    // Get current URL to verify we're in the same session
    console.log("\n4. Getting current URL (should be example.com)...");
    const urlResult = await client.callTool({
      name: "browserbase_stagehand_get_url",
      arguments: {
        sessionId: sessionId,
      },
    });
    console.log("   ✅ URL retrieved");
    console.log(`   Response: ${JSON.stringify(urlResult.content)}`);

    // Now test: Can we reuse this sessionId WITHOUT calling session_create again?
    console.log("\n5. Testing session reuse WITHOUT calling session_create...");
    console.log("   (Just using the same sessionId for another navigation)");
    
    const navResult2 = await client.callTool({
      name: "browserbase_stagehand_navigate",
      arguments: {
        url: "https://example.org",
        sessionId: sessionId, // Reusing the SAME sessionId
      },
    });
    console.log("   ✅ Second navigation completed");
    console.log(`   Response: ${JSON.stringify(navResult2.content).substring(0, 100)}...`);

    // Get URL again to verify we're still in the same session
    console.log("\n6. Getting current URL again (should be example.org)...");
    const urlResult2 = await client.callTool({
      name: "browserbase_stagehand_get_url",
      arguments: {
        sessionId: sessionId,
      },
    });
    console.log("   ✅ URL retrieved");
    console.log(`   Response: ${JSON.stringify(urlResult2.content)}`);

    // Test: What happens if we DON'T pass sessionId?
    console.log("\n7. Testing what happens WITHOUT sessionId (should create new session)...");
    const navResult3 = await client.callTool({
      name: "browserbase_stagehand_navigate",
      arguments: {
        url: "https://example.net",
        // NO sessionId - should create new session
      },
    });
    console.log("   ⚠️  Navigation without sessionId completed");
    console.log(`   Response: ${JSON.stringify(navResult3.content).substring(0, 100)}...`);

    // Test: Can we call session_create with an existing sessionId?
    console.log("\n8. Testing: Calling session_create with existing sessionId...");
    try {
      const createResult2 = await client.callTool({
        name: "browserbase_session_create",
        arguments: {
          sessionId: sessionId, // Passing existing sessionId
        },
      });
      const newSessionId = extractSessionId((createResult2.content as any[]) || []);
      console.log(`   Response: ${JSON.stringify(createResult2.content).substring(0, 200)}...`);
      if (newSessionId) {
        console.log(`   ⚠️  Got new sessionId: ${newSessionId}`);
        if (newSessionId === sessionId) {
          console.log("   ✅ SessionId matches - session was reused!");
        } else {
          console.log("   ❌ SessionId differs - NEW session was created!");
        }
      } else {
        console.log("   ⚠️  Could not extract sessionId from response");
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : error}`);
    }

    // Close the session
    console.log("\n9. Closing session...");
    await client.callTool({
      name: "browserbase_session_close",
      arguments: {
        sessionId: sessionId,
      },
    });
    console.log("   ✅ Session closed");

    await client.close();
    console.log("\n✅ Test completed successfully!");
    
    return { success: true, sessionId };
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    await client.close().catch(() => {});
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Run the test
testSessionReuse()
  .then((result) => {
    if (result.success) {
      console.log("\n✅ Session reuse test PASSED");
      process.exit(0);
    } else {
      console.log("\n❌ Session reuse test FAILED");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });

