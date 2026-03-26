# ChatCut Desktop — Quick Start

Get the desktop app running in 5 minutes.

## Prerequisites

| Tool | Install |
|------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **FFmpeg** (for export) | `brew install ffmpeg` (macOS) or [ffmpeg.org](https://ffmpeg.org/download.html) |
| **Xcode CLI** (macOS only) | `xcode-select --install` |

Verify everything is installed:

```bash
node -v       # v18+
rustc --version   # 1.70+
ffmpeg -version
```

## Launch

```bash
cd web
npm install          # first time only
npm run tauri:dev
```

The first run compiles Rust dependencies and takes 2-5 minutes. After that it's fast.

A native desktop window will open with the full ChatCut editor, including file dialogs and FFmpeg export.

## Environment (API keys)

If the AI chat doesn't work, make sure `web/.env.local` exists with your keys:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
RUNWAY_API_KEY=your_key
```

## Common Issues

| Issue | Fix |
|-------|-----|
| `rustc: command not found` | Restart your terminal or run `source $HOME/.cargo/env` |
| First build is slow | Normal — Rust compiles deps once. Subsequent runs are incremental. |
| Port 3002 in use | Kill the process on that port, or it's already running |
| Export button greyed out | Make sure FFmpeg is installed and on your PATH |
