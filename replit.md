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
- `POST /api/tasks/:id/replay` - Replay a completed task with cached session/actions
- `POST /api/tasks/:id/cancel-replay` - Cancel/delete replay state for a task
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
- `browserbase_screenshot` - Capture screenshots (automatically normalized to viewable format)
- And more (automatically loaded from MCP server)

### Replay Feature

Tasks automatically capture replay state (sessionId, URL, actions) for replay:
- **After completion**: UI shows "Replay" and "Cancel" buttons
- **On Replay**: Reuses session, navigates to cached URL, executes all cached actions
- **On Cancel**: Deletes replay state (stateless, no database)
- **Replay State**: Automatically cleaned up after replay completion or cancellation

## Render Deployment (Free Plan Limitations)

⚠️ **Important**: If deploying on Render's free plan, be aware of these limitations:

### Critical Limitations:

1. **Idle Spin-Down (15 minutes)**
   - Free services automatically spin down after 15 minutes of inactivity
   - First request after spin-down can take up to 60 seconds to wake up
   - **Impact**: WebSocket connections will be lost, in-memory state (tasks, logs, replayState) is cleared
   - **Workaround**: Keep service active with periodic health checks or upgrade to paid plan

2. **Service Restarts**
   - Render may restart free services at any time
   - **Impact**: All in-memory data (tasks, logs, replayState) is lost on restart
   - **Workaround**: This is expected behavior - users will need to re-run tasks after restarts

3. **No Persistent Storage**
   - Free services don't support persistent disks
   - **Impact**: All state is ephemeral - tasks and replayState only exist while service is running
   - **Workaround**: Consider upgrading to paid plan with persistent storage, or use external database

4. **Monthly Limits**
   - 750 free instance hours per month
   - **Impact**: Services suspended if limit exceeded
   - **Workaround**: Monitor usage in Render dashboard

5. **WebSocket Considerations**
   - WebSocket connections may be interrupted during spin-down/restart
   - **Impact**: Real-time logs may disconnect, UI may need to reconnect
   - **Workaround**: UI automatically reconnects WebSocket, but users may need to refresh

### Recommendations for Free Plan:

- **For Development/Testing**: Free plan is fine, but expect data loss on restarts
- **For Production**: Consider upgrading to paid plan ($7/month starter) for:
  - No spin-down (always-on service)
  - Persistent storage option
  - Better reliability
  - More instance hours

### Current Architecture (Stateless):

The application is designed to work with Render's free plan limitations:
- In-memory storage (no database required)
- WebSocket reconnection handling
- Task state managed per-session
- Replay state cleaned up after use

However, **all data is lost on service restart or spin-down** - this is expected behavior on the free plan.

## Development

The app runs on port 5000 with both frontend and backend served together. The workflow "Start application" runs `npm run dev`.

## Deployment (Render)

The application is configured for deployment on Render via GitHub.

### Setup Steps:

1. **Push to GitHub**: Ensure your code is pushed to `https://github.com/ayu2310/browser-orchestrator-render`

2. **Create Render Service**:
   - Go to Render dashboard
   - Create a new Web Service
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml` configuration

3. **Environment Variables** (set in Render dashboard):
   - `OPENAI_API_KEY` (required) - Your OpenAI API key for GPT-4o
   - `MCP_API_KEY` (optional) - API key for MCP server if required
   - `MCP_SERVER_URL` - Already configured in `render.yaml`, but can be overridden
   - `NODE_ENV` - Set to `production` (already in render.yaml)
   - `PORT` - Automatically set by Render (defaults to 10000 in config)

4. **Build & Deploy**:
   - Render will automatically:
     - Run `npm install && npm run build`
     - Start with `npm start`
   - The build process creates both client (Vite) and server (esbuild) bundles

### Screenshot Handling

Screenshots are automatically:
- **Extracted** from MCP server responses in multiple formats
- **Normalized** to `data:image/png;base64,` format for consistent display
- **Passed** to the orchestrator for LLM vision analysis
- **Displayed** in the UI with a "View Screenshot" button in each log entry
- **Optimized** for display with max-height constraints and error handling

Screenshots are captured after:
- Navigation actions (`browserbase_stagehand_navigate`)
- Action executions (`browserbase_stagehand_act`)
- Any function that returns screenshot data

The UI displays screenshots with:
- Expandable/collapsible view
- Full-width responsive display
- Maximum height of 600px for readability
- Automatic error handling for invalid image data

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
