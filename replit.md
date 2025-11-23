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
  - `POST /api/tasks/execute` - Execute a new automation task
  - `POST /api/tasks/cancel` - Cancel current running task
- **WebSocket Server**: Real-time log broadcasting at `/ws`
- **Storage**: In-memory storage for tasks and logs

### Core Components

1. **MCP Client** (`server/mcp-client.ts`)
   - Connects to BrowserBase MCP server
   - Lists available automation tools
   - Executes function calls

2. **Orchestrator** (`server/orchestrator.ts`)
   - Uses OpenAI GPT-5 to interpret user prompts
   - Breaks down tasks into MCP function calls
   - Executes browser automation steps sequentially
   - Provides real-time logging

## Environment Variables

Required:
- `OPENAI_API_KEY` - OpenAI API key for the orchestrator agent (stored as secret)

Optional:
- `MCP_SERVER_URL` - URL of your BrowserBase MCP server (default: http://localhost:3001)
- `MCP_API_KEY` - API key for MCP server authentication (if required)

## Setup Instructions

1. **Add OpenAI API Key**: Already requested via secret management

2. **Configure MCP Server**:
   - Set `MCP_SERVER_URL` environment variable to your BrowserBase MCP server URL
   - If your MCP server requires authentication, set `MCP_API_KEY`

3. **MCP Server Requirements**:
   Your BrowserBase MCP server should expose:
   - `GET /tools` - Returns list of available browser automation functions
   - `POST /call` - Executes a function call with arguments

## How It Works

1. User enters a natural language prompt (e.g., "Navigate to google.com and search for OpenAI")
2. Frontend sends prompt to backend via `/api/tasks/execute`
3. Backend creates task and initializes orchestrator
4. Orchestrator uses OpenAI GPT-5 to:
   - Understand the task
   - Determine which MCP functions to call
   - Execute functions in correct sequence
5. Real-time logs stream via WebSocket to frontend
6. Task completes with success or error status
7. Results saved in task history

## Development

The app runs on port 5000 with both frontend and backend served together. The workflow "Start application" runs `npm run dev`.

## Project Structure

```
client/
├── src/
│   ├── pages/
│   │   └── home.tsx          # Main UI
│   ├── components/ui/        # Shadcn components
│   └── lib/
│       └── queryClient.ts    # API client
server/
├── routes.ts                 # API routes + WebSocket
├── storage.ts                # In-memory data storage
├── mcp-client.ts            # MCP server integration
└── orchestrator.ts          # OpenAI agent orchestrator
shared/
└── schema.ts                # Shared TypeScript types
```

## User Experience

- Clean, developer-focused UI with minimal chrome
- Terminal-style log viewer with color-coded messages
- Real-time execution feedback
- Task history sidebar showing past executions
- Keyboard shortcut (Cmd/Ctrl+Enter) to execute
