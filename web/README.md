# ChatCut — AI-Powered Desktop Video Editor

A professional desktop video editor with complete AI/agentic assistance. Built with **Tauri 2** (Rust) + **Next.js 16** (React 19 / TypeScript). Uses a Python FastAPI backend for AI-powered natural language editing via Gemini or Groq.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│               Tauri Desktop Shell                │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │       Webview (React / Next.js)          │    │
│  │  Canvas Engine · Zustand · shadcn/ui     │    │
│  │  Chat Interface · Timeline · Preview     │    │
│  └─────────────────┬────────────────────────┘    │
│                    │ Tauri IPC                    │
│  ┌─────────────────▼────────────────────────┐    │
│  │       Rust Backend (src-tauri/)           │    │
│  │  • Native file system access             │    │
│  │  • Native file dialogs                   │    │
│  │  • FFmpeg detection & orchestration      │    │
│  │  • Media file scanning                   │    │
│  └─────────────────┬────────────────────────┘    │
│                    │ HTTP (localhost:3001)        │
│  ┌─────────────────▼────────────────────────┐    │
│  │       Python AI Backend (FastAPI)         │    │
│  │  • Gemini / Groq function calling        │    │
│  │  • Natural language → editing actions    │    │
│  │  • Redis caching (optional)              │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## Prerequisites — Install These FIRST

You must install **all four** tools below before ChatCut will run. Follow each step for your operating system.

### Step 1: Node.js (v18 or newer)

**Check if already installed:**
```bash
node --version
```
If this prints `v18.x.x` or higher, skip to Step 2.

**macOS:**
```bash
# Option A: Official installer
# Download from https://nodejs.org (LTS version recommended)

# Option B: Homebrew
brew install node
```

**Windows:**
```powershell
# Option A: Official installer
# Download from https://nodejs.org (LTS version recommended)
# Run the .msi installer — accept all defaults.

# Option B: winget
winget install OpenJS.NodeJS.LTS
```

**Verify after install:**
```bash
node --version   # Should print v18.x.x or higher
npm --version    # Should print 9.x.x or higher
```

---

### Step 2: Rust (v1.70 or newer)

**Check if already installed:**
```bash
rustc --version
```
If this prints `1.70.0` or higher, skip to Step 3.

**macOS:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
When prompted, choose option 1 (default installation). Then restart your terminal or run:
```bash
source "$HOME/.cargo/env"
```

**Windows:**
1. Go to https://win.rustup.rs and download `rustup-init.exe`
2. Run it. When it asks about Visual Studio, say **Yes** to install the prerequisites.
3. **IMPORTANT**: During the Visual Studio Build Tools installer, check the box for **"Desktop development with C++"**. This is required — without it, Rust cannot compile.
4. After installation, **restart your terminal** (close and reopen PowerShell/cmd).

**Verify after install:**
```bash
rustc --version   # Should print 1.70.0 or higher
cargo --version   # Should print 1.70.0 or higher
```

---

### Step 3: Platform-Specific System Dependencies

**macOS — Xcode Command Line Tools:**
```bash
xcode-select --install
```
Click "Install" in the popup. If it says "already installed", you're good.

**Windows — WebView2 Runtime:**
WebView2 comes pre-installed on Windows 10 (version 1803+) and all Windows 11 machines. You almost certainly already have it.

To verify: open Edge browser. If Edge works, WebView2 is present.

If for some reason it's missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

### Step 4: Python (v3.9 or newer) — for the AI backend

**Check if already installed:**
```bash
python3 --version
```
If this prints `3.9.x` or higher, skip to Step 5.

**macOS:**
```bash
# Python 3 usually comes with Xcode CLT. If not:
brew install python@3.11
```

**Windows:**
```powershell
# Option A: Microsoft Store (recommended — handles PATH automatically)
winget install Python.Python.3.11

# Option B: python.org installer
# Download from https://www.python.org/downloads/
# IMPORTANT: Check "Add Python to PATH" during installation!
```

**Verify:**
```bash
python3 --version   # macOS / Linux
python --version    # Windows (may use 'python' instead of 'python3')
```

---

### Step 5: FFmpeg (recommended but not strictly required)

FFmpeg is needed for video export and transcoding. ChatCut will run without it, but export features will be disabled (indicated by an "FFmpeg ✗" badge in the header).

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
```powershell
# Option A: Chocolatey (run PowerShell as Administrator)
choco install ffmpeg

# Option B: winget
winget install Gyan.FFmpeg

# Option C: Manual install
# 1. Go to https://www.gyan.dev/ffmpeg/builds/
# 2. Download "ffmpeg-release-essentials.zip"
# 3. Extract to C:\ffmpeg
# 4. Add C:\ffmpeg\bin to your system PATH:
#    - Open Start → search "Environment Variables"
#    - Edit PATH → Add "C:\ffmpeg\bin"
#    - Restart your terminal
```

**Verify:**
```bash
ffmpeg -version   # Should print version info
```

---

## Setup — Get ChatCut Running

Follow these steps in order. Don't skip any.

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd ChatCut
```

### 2. Install frontend dependencies

```bash
cd web
npm install
```

This installs JavaScript dependencies, the Tauri CLI, and Tauri plugins. It may take 1-2 minutes on first run.

### 3. Set up the AI backend

The AI backend lives in `backend/` (at the repo root). You have two options:

#### Option A: Run the backend directly (recommended for development)

```bash
# From the repo root (ChatCut/)
cd backend

# Create a Python virtual environment
python3 -m venv venv             # macOS / Linux
# or
python -m venv venv              # Windows

# Activate it
source venv/bin/activate         # macOS / Linux
.\venv\Scripts\Activate.ps1      # Windows PowerShell
.\venv\Scripts\activate.bat      # Windows cmd

# Install Python dependencies
pip install -r requirements.txt

# Create your environment config
cp .env.example .env
```

Now open `backend/.env` in your editor and add at least one API key:

```env
# Choose one:
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
# or
AI_PROVIDER=groq
GROQ_API_KEY=your_key_here
```

Get API keys from:
- **Gemini**: https://aistudio.google.com/app/apikey
- **Groq** (free tier, recommended for testing): https://console.groq.com/keys

Start the backend:
```bash
python main.py
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:3001
```

**Leave this terminal running.** Open a new terminal for the next step.

#### Option B: Docker Compose (includes Redis caching)

```bash
# From the repo root (ChatCut/)
cp backend/.env.example backend/.env
# Edit backend/.env and add your API keys (same as above)
docker compose up -d
```

This starts both the FastAPI backend (port 3001) and Redis (port 6379).

### 4. Launch the desktop app

Open a **new terminal** (leave the backend running in the other one):

```bash
cd web
npm run tauri:dev
```

What happens:
1. Next.js dev server starts on port 3002 (this takes ~1 second)
2. Rust backend compiles (first time: ~60 seconds, after that: ~10 seconds)
3. The ChatCut desktop window opens

You should see:
- The ChatCut editor window with the "Desktop" badge in the header
- An "FFmpeg ✓" or "FFmpeg ✗" badge (depending on Step 5)
- A green "Connected" dot in the chat panel (if the backend is running)

### 5. Verify everything works

1. **Desktop badge** — The header should show "Desktop" in purple. This means Tauri is running.
2. **FFmpeg badge** — Should show "FFmpeg ✓" in green. If red, install FFmpeg (Step 5 in Prerequisites).
3. **Chat connection** — The chat panel (toggle with the chat icon in the header) should show a green "Connected" dot. If red, make sure the backend is running on port 3001.
4. **Video import** — Click the "+" button or drop a video file. In desktop mode, this opens a native file picker. In browser mode, it uses the standard browser dialog.
5. **AI editing** — With a video loaded and the backend connected, try typing "zoom in by 150%" in the chat. The AI should process it and apply the zoom.

---

## Daily Development Workflow

Once setup is complete, your daily workflow is:

**Terminal 1 — AI Backend:**
```bash
cd backend
source venv/bin/activate    # macOS/Linux
# .\venv\Scripts\Activate.ps1  # Windows
python main.py
```

**Terminal 2 — Desktop App:**
```bash
cd web
npm run tauri:dev
```

That's it. The app opens, you edit code, and changes hot-reload automatically.

### Browser-Only Mode (Quick UI Iteration)

If you're only working on the UI and don't need native features:

```bash
cd web
npm run dev
# Open http://localhost:3002
```

This is faster to start but won't have native file dialogs, FFmpeg integration, or the "Desktop" badge.

---

## NPM Scripts Reference

| Command               | What it does                                          |
|------------------------|-------------------------------------------------------|
| `npm run tauri:dev`    | Start the full desktop app with hot-reload            |
| `npm run tauri:build`  | Build a production installer (.dmg on Mac, .msi on Windows) |
| `npm run dev`          | Start Next.js only (browser mode, no Tauri)           |
| `npm run build`        | Build Next.js for production                          |
| `npm run lint`         | Run ESLint                                            |
| `npm run tauri:icons`  | Regenerate icons from `app-icon.png`                  |

---

## Project Structure

```
web/
├── src/                        # Frontend source (TypeScript / React)
│   ├── app/                    # Next.js App Router (pages)
│   │   ├── page.tsx            # Main editor page
│   │   ├── layout.tsx          # Root layout (fonts, theme)
│   │   └── globals.css         # Global styles (Tailwind)
│   ├── components/
│   │   ├── chat/               # AI chat panel
│   │   │   ├── ChatPanel.tsx   # Chat sidebar component
│   │   │   └── ChatMessage.tsx # Individual message bubble
│   │   ├── editor/             # Editor components
│   │   │   ├── VideoPreview.tsx      # Canvas preview + file import
│   │   │   ├── TransportControls.tsx # Play/pause/seek/volume
│   │   │   └── timeline/            # Timeline panel (tracks, clips, ruler)
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useChat.ts          # Chat state + AI communication
│   │   ├── useVideoEngine.ts   # Canvas engine lifecycle
│   │   └── useTauriStatus.ts   # Desktop mode detection + health checks
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── client.ts       # FastAPI backend HTTP client
│   │   │   └── action-mapper.ts # AI actions → typed EditActions
│   │   ├── commands/
│   │   │   └── command-handler.ts # Execute actions + undo/redo
│   │   ├── engine/
│   │   │   └── video-engine.ts # Canvas renderer (60fps, non-React)
│   │   ├── store/
│   │   │   └── editor-store.ts # Zustand state (single source of truth)
│   │   └── tauri/
│   │       └── bridge.ts       # TypeScript ↔ Rust IPC bridge
│   └── types/
│       └── editor.ts           # All TypeScript type definitions
├── src-tauri/                  # Tauri / Rust backend
│   ├── src/
│   │   ├── main.rs             # Entry point (hides console on Windows)
│   │   ├── lib.rs              # Plugin registration + command binding
│   │   └── commands.rs         # Native commands (file I/O, FFmpeg)
│   ├── capabilities/
│   │   └── default.json        # Permission grants (fs, dialog, shell)
│   ├── icons/                  # Generated app icons (all platforms)
│   ├── Cargo.toml              # Rust dependencies
│   └── tauri.conf.json         # Tauri configuration
├── package.json                # Node dependencies + scripts
├── next.config.ts              # Next.js config (Tauri-aware)
├── app-icon.png                # Source icon (run tauri:icons to regenerate)
└── README.md                   # ← You are here
```

---

## Cross-Platform Development (Mac + Windows Team)

### Why Not Docker?

Docker **cannot** be used for developing the desktop app:
- Tauri needs native system WebView (WebKit on macOS, WebView2 on Windows)
- Docker containers don't have GUI frameworks
- GPU acceleration and native window management don't work in containers

Docker is fine for the **AI backend only** (`docker compose up` from the repo root).

### What to Watch For

| Concern | macOS | Windows | How to avoid issues |
|---------|-------|---------|---------------------|
| WebView engine | WebKit (Safari-based) | WebView2 (Chromium/Edge-based) | Test CSS on both. WebKit is stricter. |
| File paths | `/Users/name/Videos/clip.mp4` | `C:\Users\name\Videos\clip.mp4` | Use the Tauri bridge, never hardcode path separators |
| Line endings | LF | CRLF | Already handled by `.gitattributes` in repo root |
| FFmpeg install | `brew install ffmpeg` | `choco install ffmpeg` or manual PATH | Use the `check_ffmpeg` Tauri command |
| Shell/terminal | bash / zsh | PowerShell / cmd | Use Tauri's shell plugin, not raw `child_process` |
| First Rust build | ~60 seconds | ~90-120 seconds (MSVC is slower) | Normal — subsequent builds are ~10s |
| Code signing | Apple Developer ID certificate | Windows code signing certificate | Only needed for distribution, not during development |
| Python command | `python3` | `python` | Noted separately in setup instructions above |

### Recommended Team Workflow

1. Everyone works from the same repo (same branch or feature branches)
2. Mac team members test on macOS and verify WebKit rendering
3. Windows team members test on Windows and verify WebView2 rendering
4. Before merging a PR, at least one Mac dev and one Windows dev should confirm it works
5. The AI backend is platform-independent — share one instance or run individually

### Sharing a Single AI Backend

If the team wants to share one AI backend instance instead of everyone running their own:

1. One team member starts the backend on their machine
2. Find their local IP: `ipconfig` (Windows) or `ifconfig` (macOS)
3. Start the backend on all interfaces:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 3001
   ```
4. Other team members update their Next.js config to point to the shared server (edit `next.config.ts` and change `localhost:3001` to `<shared-ip>:3001`)

---

## Building for Production

### macOS (.dmg installer)
```bash
cd web
npm run tauri:build
```
Output: `src-tauri/target/release/bundle/dmg/ChatCut_0.1.0_aarch64.dmg`

### Windows (.msi installer)
```bash
cd web
npm run tauri:build
```
Output: `src-tauri/target/release/bundle/msi/ChatCut_0.1.0_x64_en-US.msi`

**Important**: You must build on the target platform. macOS builds produce .dmg files, Windows builds produce .msi files. Cross-compilation is not recommended for desktop apps.

---

## Troubleshooting

### "Port 3002 already in use"

Another process is using the port. Kill it:

```bash
# macOS / Linux
lsof -ti:3002 | xargs kill -9

# Windows PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 3002).OwningProcess | Stop-Process -Force
```

### First Rust build takes a very long time

This is normal. Tauri compiles ~400+ Rust crates on the first build. It takes 60-120 seconds depending on your machine. Every subsequent build only recompiles changed code (~10 seconds).

### Chat panel shows "Disconnected" (red dot)

The Python backend isn't running or isn't reachable on port 3001.
1. Make sure you started the backend (`python main.py` in `backend/`)
2. Check that it printed `Uvicorn running on http://127.0.0.1:3001`
3. Check that your API keys in `backend/.env` are valid

### White/blank screen in the desktop window

- **macOS**: Run `xcode-select --install` to ensure CLT is installed
- **Windows**: Verify WebView2 is installed (open Edge — if Edge works, WebView2 is present)
- Right-click in the window → "Inspect Element" to open DevTools and check for JavaScript errors

### "FFmpeg not found" or "FFmpeg ✗" badge

ChatCut runs fine without FFmpeg — only export features are disabled. To fix:
- macOS: `brew install ffmpeg`
- Windows: `choco install ffmpeg` (or see Step 5 in Prerequisites)
- Then restart the desktop app

### Rust compilation errors on Windows

Most common cause: missing Visual Studio C++ Build Tools.
1. Run `rustup show` — verify it shows `stable-x86_64-pc-windows-msvc`
2. Open Visual Studio Installer → Modify → check "Desktop development with C++"
3. Restart your terminal

### Python "command not found"

- On macOS/Linux, use `python3` instead of `python`
- On Windows, if you installed from the Microsoft Store, use `python`
- Make sure Python is on your PATH

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Tauri 2 (Rust) | Native window, file I/O, FFmpeg, system integration |
| Frontend | Next.js 16 + React 19 | UI framework |
| State Management | Zustand | Reactive store (read by engine outside React) |
| Video Engine | Custom Canvas renderer | 60fps real-time preview via requestAnimationFrame |
| UI Components | shadcn/ui + Radix UI | Accessible, styled component library |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| AI Backend | FastAPI (Python) | LLM function calling + action extraction |
| AI Providers | Google Gemini / Groq | Natural language → structured editing actions |
| Caching | Redis (optional) | Cache AI responses to save API credits |
