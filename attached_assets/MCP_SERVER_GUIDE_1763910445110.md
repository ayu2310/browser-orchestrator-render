# Browserbase MCP Server - User Guide

Production-ready Model Context Protocol (MCP) server for browser automation. **Fully stateless**—returns `flowState` snapshots you must persist externally.

**Endpoint:** `https://browserbase-mcp-server-iub9cl6kc-ayus-projects-56bd70c3.vercel.app/api/mcp`

## Connecting to the MCP Server

To connect to the MCP server, use the MCP SDK with `StreamableHTTPClientTransport`:

```javascript
const { Client } = require('@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js');

// Connect to the MCP server
const transport = new StreamableHTTPClientTransport('https://browserbase-mcp-server-iub9cl6kc-ayus-projects-56bd70c3.vercel.app/api/mcp');
const client = new Client({ name: 'my-client', version: '1.0.0' });

// Handle connection errors
client.onerror = (error) => {
  console.error('MCP Client Error:', error.message || error);
};

// Connect
await client.connect(transport);
console.log('✅ Connected to MCP server');

// Now you can call tools
const result = await client.callTool({
  name: 'browserbase_session_create',
  arguments: { flowState: { cacheKey: 'my-flow' } }
});

// Close when done
await client.close();
```

**Installation:**
```bash
npm install @modelcontextprotocol/sdk
```

## Core Concept

**Stateless Architecture:** The server stores NO data. Every tool call returns a `flowState` JSON payload. You must:
1. **Capture** `flowState` from each response
2. **Persist** it externally (database, file, etc.)
3. **Feed it back** for session reuse and replays

## FlowState Structure

```json
{
  "cacheKey": "unique-workflow-id",
  "startingUrl": "https://example.com",
  "browserbaseSessionId": "session-id",
  "actions": [
    {
      "type": "action",
      "data": { 
        "action": "Click login button",
        "variables": {}
      },
      "timestamp": 1234567890
    },
    {
      "type": "observation",
      "data": {
        "method": "click",
        "selector": "button#login",
        "xpath": "/html/body/div[1]/button[@id='login']",
        "arguments": [],
        "description": "Click the login button"
      },
      "timestamp": 1234567891
    }
  ]
}
```

**Fields:**
- `cacheKey`: Unique workflow identifier (auto-generated if not provided)
- `startingUrl`: Initial URL (captured by `browserbase_stagehand_navigate`)
- `browserbaseSessionId`: Session ID for session reuse
- `actions`: Chronological array of actions for replay

### Action Types in FlowState

**1. Natural Language Actions (`type: "action"`)**
Used for prompt-based actions. Stored when you pass the `action` parameter:

```json
{
  "type": "action",
  "data": {
    "action": "Click the login button in the top right corner",
    "variables": {}
  },
  "timestamp": 1234567890
}
```

**2. Deterministic/Observation Actions (`type: "observation"`)**
Used for XPath/selector-based actions. Stored when you pass the `observation` parameter (typically from `browserbase_stagehand_observe`):

```json
{
  "type": "observation",
  "data": {
    "method": "click",
    "selector": "button#login",
    "xpath": "/html/body/div[1]/button[@id='login']",
    "arguments": [],
    "description": "Click the login button"
  },
  "timestamp": 1234567891
}
```

**Observation Data Fields:**
- `method`: Action method (e.g., "click", "fill", "select")
- `selector`: CSS selector for the element
- `xpath`: XPath expression for the element
- `arguments`: Array of arguments for the action (e.g., text to fill)
- `description`: Human-readable description of the action

**Note:** Both action types are automatically stored in `flowState.actions` and can be replayed deterministically.

## Key Tools

### `browserbase_session_create`
Creates/reuses a Browserbase session. Returns `flowState` with `browserbaseSessionId`.

**Parameters:** `flowState` (optional)

### `browserbase_stagehand_navigate`
Navigates to a URL. Captures `startingUrl` in `flowState`.

**Parameters:** `url` (required), `flowState` (optional)

### `browserbase_stagehand_act`
Two modes:

**Mode 1: Single Action**
- Parameters: `action` or `observation` + `flowState`
- Appends action to `flowState.actions`
- Returns updated `flowState`

**Mode 2: Replay**
- Parameters: `replayState` (complete `flowState`)
- Reuses session, navigates to `startingUrl`, executes all actions sequentially
- Self-heals on selector failures

### `browserbase_stagehand_observe`
Finds elements with deterministic selectors. Returns an array of observation objects that can be used with `browserbase_stagehand_act`.

**Parameters:** `instruction` (required), `returnAction` (optional, default: false), `flowState` (optional)

**Returns:** Array of observation objects with `method`, `selector`, `xpath`, `arguments`, and `description` fields.

**Example:**
```javascript
const observeResult = await mcp.call('browserbase_stagehand_observe', {
  instruction: 'Find the login button',
  returnAction: true,
  flowState: flowState
});
// Parse observations array from response content
const observations = extractObservations(observeResult.content);
// Use first observation for deterministic action
await mcp.call('browserbase_stagehand_act', {
  observation: observations[0],
  flowState: flowState
});
```

### Other Tools
- `browserbase_stagehand_extract`: Extract structured data (⚠️ known Browserbase MCP package issue)
- `browserbase_screenshot`: Capture screenshots (returns image format)
- `browserbase_stagehand_get_url`: Get current URL
- `browserbase_session_close`: Close session
- `browserbase_list_cached_actions`: Format `flowState` for inspection

**All tools accept optional `flowState` parameter for session reuse.**

## Usage Pattern

```javascript
// 1. Create session
let flowState = extractFlowState(await mcp.call('browserbase_session_create', {
  flowState: { cacheKey: 'my-flow' }
}));
await db.save('my-flow', flowState);

// 2. Navigate
flowState = extractFlowState(await mcp.call('browserbase_stagehand_navigate', {
  url: 'https://example.com',
  flowState: flowState
}));
await db.save('my-flow', flowState);

// 3. Act (Natural Language)
flowState = extractFlowState(await mcp.call('browserbase_stagehand_act', {
  action: 'Click login button',
  flowState: flowState
}));
await db.save('my-flow', flowState);

// 3b. Act (Deterministic - using observation from browserbase_stagehand_observe)
const observeResult = await mcp.call('browserbase_stagehand_observe', {
  instruction: 'Find the login button',
  returnAction: true,
  flowState: flowState
});
const observations = extractObservations(observeResult.content); // Parse array from response
if (observations && observations.length > 0) {
  flowState = extractFlowState(await mcp.call('browserbase_stagehand_act', {
    observation: observations[0], // Pass full observation object
    flowState: flowState
  }));
  await db.save('my-flow', flowState);
}

// 4. Replay (later)
const savedFlow = await db.get('my-flow');
await mcp.call('browserbase_stagehand_act', {
  replayState: savedFlow
});
```

## ⚠️ Critical: Session Reuse

**You MUST pass `flowState` on EVERY call within a session, or a new session will be created each time.**

```javascript
// ❌ WRONG - Creates new session on each call
await mcp.call('browserbase_session_create', {});
await mcp.call('browserbase_stagehand_navigate', { url: 'https://example.com' }); // New session!
await mcp.call('browserbase_stagehand_act', { action: 'Click button' }); // New session!

// ✅ CORRECT - Reuses same session
let flowState = extractFlowState(await mcp.call('browserbase_session_create', { flowState: {} }));
flowState = extractFlowState(await mcp.call('browserbase_stagehand_navigate', { 
  url: 'https://example.com', 
  flowState: flowState  // ← Required!
}));
flowState = extractFlowState(await mcp.call('browserbase_stagehand_act', { 
  action: 'Click button',
  flowState: flowState  // ← Required!
}));
```

**Why?** The server extracts `browserbaseSessionId` from `flowState` and passes it to Browserbase. Without `flowState`, each call creates a new session.

## Best Practices

1. **Always pass `flowState`**: Every tool call within a session MUST include the latest `flowState` to reuse the session
2. **Extract after each call**: Extract `flowState` from every response and update your local copy
3. **Persist for replay**: Save the final `flowState` for future replays
4. **Use deterministic actions**: Use `observation` parameter for reliable replays
5. **Handle errors gracefully**: Actions are appended to `flowState` even if execution fails

## Response Format

All tools return responses with `flowState`:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Tool execution result..."
    },
    {
      "type": "text",
      "text": "flowState (persist externally): { ... }"
    }
  ]
}
```

Extract `flowState` from the response text using the pattern: `flowState (persist externally): {JSON}`

## Status

✅ **Production Ready**: Deployed and tested
✅ **Actions accumulate**: Even when Browserbase API has errors
✅ **Replay works**: Deterministic execution of saved workflows
✅ **Session reuse**: Maintains browser state across calls
