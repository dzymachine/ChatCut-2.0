# ChatCut Desktop/Web — Setup Guide

> For team members coming from the plugin version who need to get the new standalone desktop app running.

## What Changed

The repo has been reorganized:

- **`plugin/`** — the old Premiere Pro plugin code (backend + frontend) moved here
- **`web/`** — the new standalone desktop app (Tauri + Next.js) lives here

The AI backend (`backend/`) is shared between both versions.

---

## Step 1: Pull the Latest Code

```bash
cd ChatCut
git pull origin main
```

You'll see the new `web/` folder and the old code moved under `plugin/`.

---

## Step 2: Install Prerequisites

### Node.js (v18+)

You likely already have this from the plugin work. Verify:

```bash
node -v   # should be v18 or higher
```

### Rust (v1.70+)

Tauri needs Rust. Install it via [rustup](https://rustup.rs):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

After install, restart your terminal and verify:

```bash
rustc --version   # should be 1.70+
cargo --version
```

### Platform-Specific Dependencies

**macOS** — Install Xcode Command Line Tools (you probably already have this):

```bash
xcode-select --install
```

**Windows** — WebView2 Runtime is required (pre-installed on Windows 10/11 21H2+). If not present, download from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

**Linux** — Install the following:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## Step 3: Install Node Dependencies

```bash
cd web
npm install
```

This installs Next.js, React, Tauri CLI, and all frontend deps.

---

## Step 4: Set Up Environment Variables

Create `web/.env.local` with the API keys:

```bash
cd web
cp -n ../backend/.env.example .env.local
```

Then edit `web/.env.local` and fill in your actual keys:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GROQ_API_KEY=your_key_here
RUNWAY_API_KEY=your_key_here
```

Ask a teammate for the shared dev keys if you don't have them.

---

## Step 5: Start the AI Backend

The web app talks to the same Python backend as the plugin. Start it in a separate terminal:

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

The backend runs on `http://localhost:3001`.

If you already had this set up from the plugin version, just activate the venv and run `python main.py`.

---

## Step 6: Run the App

You have two options:

### Option A: Browser Only (no Rust required for quick testing)

```bash
cd web
npm run dev
```

Open [http://localhost:3002](http://localhost:3002). The app runs in your browser — Tauri-specific features (native file dialogs, FFmpeg export) won't work but everything else does.

### Option B: Desktop App via Tauri (full experience)

```bash
cd web
npm run tauri:dev
```

This compiles the Rust backend (first run takes a few minutes) and launches the native desktop window. Subsequent runs are much faster.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `rustc: command not found` | Restart your terminal after installing Rust, or run `source $HOME/.cargo/env` |
| First `tauri:dev` is slow | Normal — Rust compiles dependencies on first run (~2-5 min). Subsequent builds are incremental. |
| Port 3002 already in use | Kill the process on that port or change it in `web/package.json` (`dev` script) and `web/src-tauri/tauri.conf.json` (`devUrl`) |
| AI chat not responding | Make sure the Python backend is running on port 3001 |
| `npm install` fails on Tauri packages | Make sure Rust is installed — the Tauri CLI needs `cargo` available |

---

## Project Structure (web/)

```
web/
├── src/
│   ├── app/              # Next.js pages
│   ├── components/       # React UI (chat, editor, timeline)
│   ├── hooks/            # useChat, useVideoEngine, etc.
│   ├── lib/              # AI client, video engine, state store
│   └── types/            # TypeScript types
├── src-tauri/            # Rust/Tauri backend (native features)
├── package.json          # Node scripts & deps
├── .env.local            # API keys (gitignored)
└── next.config.ts        # Next.js config
```

---

## Useful Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Next.js dev server (browser only, port 3002) |
| `npm run tauri:dev` | Start full Tauri desktop app |
| `npm run build` | Production build (Next.js) |
| `npm run tauri:build` | Build distributable desktop app |
| `npm run lint` | Run ESLint |
