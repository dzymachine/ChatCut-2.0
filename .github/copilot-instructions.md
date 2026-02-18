Project: ChatCut

Purpose: brief instructions to help AI agents work with this project, which has two versions:
1. **Plugin** (`plugin/`) — A UXP extension for Adobe Premiere Pro
2. **Web** (`web/`) — A standalone Next.js + Tauri desktop application

Both versions share a common Python backend (`backend/`).

---

## Backend (Shared)

- `backend/` — Python FastAPI backend server (AI providers, Redis cache). Used by both plugin and web.
- `backend/main.py` — FastAPI entry point (runs on port 3001).
- `backend/services/providers/` — AI provider implementations (Gemini, Groq).
- `docker-compose.yml` — Docker orchestration for backend + Redis.

Build & run: `cd backend && python main.py` (or `docker compose up` from repo root)

---

## Plugin (Premiere Pro UXP Extension)

Plugin frontend code lives under `plugin/frontend/`.

Key files
- `plugin/frontend/plugin/manifest.json` — plugin identity, entrypoint (panel id `apps`), host/version and icons.
- `plugin/frontend/plugin/index.html` — webview shell.
- `plugin/frontend/src/index.jsx` — bootstraps UXP `entrypoints` and registers the panel controller.
- `plugin/frontend/src/panels/App.jsx` — top-level React panel component (renders `Container`).
- `plugin/frontend/src/components/*` — UI pieces: `header.jsx`, `content.jsx`, `footer.jsx`, `container.jsx`.

Architecture notes
- Small single-panel React app using UXP entrypoints and a `PanelController` wrapper located in `plugin/frontend/src/controllers/PanelController.jsx`.
- `Container` composes `Header`, `Content`, and `Footer`. `Container` owns a simple message array in state.
- Backend runs on port 3001 (FastAPI). Supports Gemini and Groq AI providers.

Build & run (Plugin)
- Backend: `cd backend && python main.py` (or `docker compose up` from repo root)
- Frontend: `cd plugin/frontend && npm install && npm run build`
- Load `plugin/frontend/dist/manifest.json` into UXP Developer Tools.

---

## Web (Next.js + Tauri Desktop Application)

All web code lives under `web/`.

- `web/src/app/` — Next.js app router pages
- `web/src/components/` — React components (chat, editor, UI)
- `web/src/lib/` — AI client, video engine, editor store
- `web/src/hooks/` — Custom React hooks
- `web/src-tauri/` — Rust backend (native file I/O, FFmpeg, system integration)

Build & run (Web)
- Backend: `cd backend && python main.py`
- Frontend: `cd web && npm install && npm run dev`

---

Conventions & gotchas
- Plugin manifest: changing `id` is a breaking change. Prefer updating `name` and `label`.
- Prefer minimal, targeted edits. Keep changes to styles local to component CSS files.

End of instructions.
