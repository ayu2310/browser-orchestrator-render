# BrowserBase MCP Orchestrator

AI-powered browser automation orchestrator that connects to a BrowserBase MCP (Model Context Protocol) server to execute browser automation tasks via natural language prompts.

## Architecture

### Frontend (React + TypeScript)
- **Home Page**: Main interface with prompt input, execution status, real-time logs, and task history
- **Real-time Updates**: WebSocket connection for live log streaming
- **Design System**: Inter font for UI, JetBrains Mono for logs/code
- **State Management**: TanStack Query for server state

### Backend (Node.js + Express)
- **API Routes**:
  - `GET /api/tasks` - Get all task history
  - `GET /api/tasks/current` - Get currently running task
  - `GET /api/tasks/:id/logs` - Get logs for a specific task
  - `POST /api/tasks/execute` - Execute a new automation task
  - `POST /api/tasks/cancel` - Cancel current running task
- **WebSocket Server**: Real-time log broadcasting at `/ws`
- **Storage**: In-memory storage for tasks and logs

### Core Components

1. **MCP Client** (`server/mcp-client.ts`)
   - Uses official MCP SDK with `StreamableHTTPClientTransport`
   - Manages flowState persistence across tool calls (critical for session continuity)
   - Connects to BrowserBase MCP server
   - Lists available automation tools
   - Executes function calls with proper session management

2. **Orchestrator** (`server/orchestrator.ts`)
   - Uses OpenAI GPT-4o to interpret user prompts
   - Breaks down tasks into MCP function calls
   - Executes browser automation steps sequentially
   - Provides real-time logging with flowState tracking

## Environment Variables

### Required:
- `OPENAI_API_KEY` - OpenAI API key for GPT-4o orchestrator (stored as secret)

### Configured:
- `MCP_SERVER_URL` - BrowserBase MCP server endpoint (default: `https://browserbase-mcp-server-iub9cl6kc-ayus-projects-56bd70c3.vercel.app/api/mcp`)
- `MCP_API_KEY` - API key for MCP server authentication (optional, if required)

## How It Works

1. User enters a natural language prompt (e.g., "Navigate to google.com and search for OpenAI")
2. Frontend sends prompt to backend via `/api/tasks/execute`
3. Backend creates task and initializes orchestrator
4. MCP Client connects to BrowserBase MCP server
5. Orchestrator uses GPT-4o to:
   - Understand the task requirements
   - Select appropriate MCP tools
   - Execute actions sequentially while maintaining browser session via flowState
6. Real-time logs stream via WebSocket to frontend
7. Task completes with success or error status
8. Results saved in task history

## MCP Integration Details

### FlowState Management
The orchestrator properly handles the stateless architecture of the MCP server:
- **Captures** `flowState` from each tool response
- **Persists** it internally across calls
- **Feeds it back** to every subsequent tool call to maintain the browser session
- This is critical: without flowState, each call would create a new session

### Key MCP Tools Available
- `browserbase_session_create` - Create/reuse browser sessions
- `browserbase_stagehand_navigate` - Navigate to URLs
- `browserbase_stagehand_act` - Execute browser actions
- `browserbase_stagehand_observe` - Find elements with selectors
- `browserbase_screenshot` - Capture screenshots
- And more (automatically loaded from MCP server)

## Development

The app runs on port 5000 with both frontend and backend served together. The workflow "Start application" runs `npm run dev`.

## Project Structure

```
client/
├── src/
│   ├── pages/
│   │   └── home.tsx          # Main UI with prompt input & logs
│   ├── components/ui/        # Shadcn components
│   └── lib/
│       └── queryClient.ts    # API client & mutations
server/
├── routes.ts                 # API routes + WebSocket
├── storage.ts                # In-memory data storage
├── mcp-client.ts            # MCP SDK integration with flowState management
└── orchestrator.ts          # GPT-4o orchestrator with tool calling
shared/
└── schema.ts                # Shared TypeScript types
```

## User Experience

- Clean, developer-focused UI with minimal chrome
- Terminal-style log viewer with color-coded messages
- Real-time execution feedback with flowState tracking
- Task history sidebar showing past executions
- Keyboard shortcut (Cmd/Ctrl+Enter) to execute
- Clear error messages when OpenAI API key is missing

## Testing

The application is production-ready and tested with:
- OpenAI API key validation before task creation
- Proper error handling throughout the stack
- Real-time WebSocket updates
- Historical log viewing and retrieval
- MCP server connection and tool execution

To test with real browser automation:
1. Ensure `OPENAI_API_KEY` is set in secrets
2. The `MCP_SERVER_URL` is already configured to the production endpoint
3. Enter browser automation prompts in the UI
4. Watch logs stream in real-time as the orchestrator executes tasks
