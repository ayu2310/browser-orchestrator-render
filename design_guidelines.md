# Design Guidelines: BrowserBase MCP Orchestrator

## Design Approach
**System Selected:** Linear + Material Design Hybrid
- Linear's clean minimalism for the interface structure
- Material Design's data display patterns for logs and status
- Developer-tool aesthetic (Vercel/GitHub-inspired)
- Focus on clarity, efficiency, and information hierarchy

## Typography System

**Font Stack:**
- Primary: Inter (Google Fonts) for UI elements and body text
- Monospace: JetBrains Mono for logs, code snippets, and technical outputs

**Hierarchy:**
- Page Title: text-2xl font-semibold
- Section Headers: text-lg font-medium
- Body Text: text-base font-normal
- Log/Code Text: text-sm font-mono
- Labels: text-sm font-medium
- Timestamps/Metadata: text-xs font-normal

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, and 8 for consistency
- Component padding: p-4 or p-6
- Section gaps: gap-4 or gap-6
- Page margins: m-8 for desktop, m-4 for mobile
- Card spacing: space-y-4

**Grid Structure:**
- Main layout: Two-column split on desktop (60/40 ratio)
  - Left: Prompt input and controls (max-w-2xl)
  - Right: Task history sidebar (w-80 to w-96)
- Mobile: Stack to single column
- Use max-w-7xl container for overall app width

## Component Library

### 1. Header/Navigation
- Fixed top bar (h-16)
- Logo/title left-aligned
- Connection status indicator right-aligned (dot + text)
- Minimal, single row layout

### 2. Prompt Input Area
- Large textarea (min-h-32) with subtle border
- Rounded corners (rounded-lg)
- Clear "Execute Task" button (primary action, large size)
- Character count indicator below
- Example prompts as placeholder or helper text below input

### 3. Execution Status Panel
- Prominent status card showing current task state
- Progress indicator (linear progress bar or spinner)
- Real-time status updates ("Connecting...", "Executing...", "Complete")
- Estimated time remaining (if applicable)
- Cancel/Stop button when task is running

### 4. Log Viewer
- Terminal-style display with monospace font
- Auto-scrolling to latest entries
- Timestamp prefix for each log line
- Log level indicators (info, success, error)
- Expandable/collapsible sections for detailed outputs
- Copy-to-clipboard button for log contents
- Max height with internal scrolling (max-h-96)

### 5. Task History Sidebar
- Scrollable list of previous tasks
- Each history item shows:
  - Task prompt (truncated, text-sm)
  - Timestamp (text-xs)
  - Status badge (success/failed/running)
  - Duration
- Click to view full task details
- Clear history button at bottom

### 6. Result Display
- Card-based layout for task outputs
- Screenshots/images in organized grid if applicable
- Structured data in tables
- Links as clickable, underlined elements
- Expandable sections for large results

### 7. MCP Connection Config
- Collapsible settings panel (not prominent)
- Server URL input field
- Connection test button
- Visual connection status feedback

## Interaction Patterns

**States:**
- Idle: Clean, ready for input
- Processing: Dimmed input, visible progress
- Success: Green accent on status
- Error: Red accent with error message, retry option

**Feedback:**
- Immediate visual response to button clicks
- Toast notifications for connection/error events
- Real-time log streaming during execution
- Subtle animations for state transitions (fade-in for new logs)

## Accessibility
- Keyboard shortcuts: Cmd/Ctrl+Enter to execute task
- Focus states on all interactive elements
- ARIA labels for status indicators
- High contrast text for logs
- Readable font sizes (minimum text-sm, prefer text-base)

## Responsive Behavior

**Desktop (lg+):**
- Two-column layout with sidebar
- Full-width log viewer
- Spacious padding (p-6 to p-8)

**Tablet (md):**
- Narrower sidebar or stack under main content
- Maintain readable log width

**Mobile (base):**
- Single column stack
- History as bottom sheet or separate view
- Sticky input area at top
- Reduced padding (p-4)

## Images
No hero image for this application - it's a functional tool, not marketing content. Focus on information architecture and data display.

## Key Principles
1. **Information First:** Prioritize readability of logs and status over decoration
2. **Minimal Chrome:** No unnecessary borders, shadows, or visual noise
3. **Professional Aesthetic:** Clean, modern, developer-focused
4. **Responsive Feedback:** Always show what the system is doing
5. **Efficiency:** Quick access to recent tasks and common actions