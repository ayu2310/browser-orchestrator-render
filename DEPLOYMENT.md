# Deployment Guide for Render

## Pre-Deployment Checklist

✅ **Build Test**: `npm run build` - PASSED
✅ **Code Changes**: All replay and screenshot features committed
✅ **Render Config**: `render.yaml` created and configured

## Git Setup & Push to GitHub

### 1. Configure Git (if not already done)
```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### 2. Add GitHub Remote
```bash
git remote add origin https://github.com/ayu2310/browser-orchestrator-render.git
```

### 3. Commit Changes (if not already committed)
```bash
git add .
git commit -m "Add replay feature, screenshot normalization, and Render deployment config"
```

### 4. Push to GitHub
```bash
git push -u origin main
```

If the repo doesn't exist yet, create it on GitHub first:
1. Go to https://github.com/ayu2310
2. Click "New repository"
3. Name it: `browser-orchestrator-render`
4. Don't initialize with README (we already have code)
5. Then run the push command above

## Render Deployment Type

**Choose: Web Service** ✅

### Why Web Service?
- Your app is a **web application** with:
  - HTTP API endpoints (`/api/tasks/*`)
  - WebSocket server (`/ws`)
  - Frontend UI (React)
  - Static file serving

### Not These:
- ❌ **Blueprint**: For multi-service deployments (you only have one service)
- ❌ **Background Worker**: For background jobs, not web apps
- ❌ **Static Site**: You have a backend server

## Render Deployment Steps

### Option 1: Using render.yaml (Recommended)
1. Go to https://dashboard.render.com
2. Click "New +" → "Blueprint"
3. Connect your GitHub account
4. Select repository: `ayu2310/browser-orchestrator-render`
5. Render will automatically detect `render.yaml`
6. Review the service configuration
7. Click "Apply"

### Option 2: Manual Web Service Setup
1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect GitHub repository: `ayu2310/browser-orchestrator-render`
4. Configure:
   - **Name**: `browser-orchestrator`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free or Starter (your choice)

### Environment Variables (Set in Render Dashboard)

**Required:**
- `OPENAI_API_KEY` - Your OpenAI API key

**Optional:**
- `MCP_API_KEY` - Only if MCP server requires authentication
- `MCP_SERVER_URL` - Already in render.yaml, override if needed

**Auto-set by Render:**
- `PORT` - Automatically set, don't override
- `NODE_ENV` - Set to `production` automatically

## Post-Deployment

1. **Test the deployment:**
   - Visit your Render URL
   - Check that the UI loads
   - Try executing a test task

2. **Monitor logs:**
   - Go to Render dashboard → Your service → Logs
   - Watch for any errors during startup

3. **Verify WebSocket:**
   - Execute a task and check if real-time logs appear

## Troubleshooting

### Build Fails
- Check Render logs for specific errors
- Ensure all dependencies are in `package.json`
- Verify Node version compatibility

### App Won't Start
- Check that `dist/index.js` exists (server bundle)
- Check that `dist/public/index.html` exists (client build)
- Verify PORT environment variable is not overridden

### Screenshots Not Displaying
- Check browser console for image loading errors
- Verify screenshot normalization in server logs
- Check MCP server connection

