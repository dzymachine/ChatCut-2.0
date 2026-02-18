# ChatCut

An AI-powered video editing assistant. Use natural language commands to edit your videos.

ChatCut comes in two versions:

| Version | Description | Location |
|---------|-------------|----------|
| **Plugin** | Adobe Premiere Pro UXP extension | [`plugin/`](plugin/) |
| **Web** | Standalone desktop/browser editor | [`web/`](web/) |

Both versions share the same AI backend (`backend/`).

---

## Project Structure

```
ChatCut/
├── backend/                 # Shared Python FastAPI server (AI, caching)
│   ├── services/            #   AI providers (Gemini, Groq), video processing
│   ├── models/              #   Pydantic schemas
│   ├── tests/               #   Backend test suite
│   └── main.py              #   FastAPI entry point
│
├── plugin/                  # Premiere Pro UXP plugin
│   ├── frontend/            #   React UXP plugin UI
│   ├── COLAB_GUIDE.md       #   Guide for Colab GPU setup
│   └── *.ipynb              #   Colab notebooks
│
├── web/                     # Standalone desktop app (Tauri + Next.js)
│   ├── src/                 #   Next.js frontend (React, TypeScript)
│   └── src-tauri/           #   Rust backend (native features, FFmpeg)
│
├── docker-compose.yml       # Docker orchestration (backend + Redis)
└── README.md                # This file
```

---

## Plugin (Premiere Pro)

The plugin version runs inside Adobe Premiere Pro as a UXP panel.

### Quick Start

```bash
# 1. Start the backend
cd backend
cp .env.example .env        # Add your GEMINI_API_KEY or GROQ_API_KEY
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py

# 2. Build the frontend
cd plugin/frontend
npm install
npm run build

# 3. Load plugin/frontend/dist/manifest.json in UXP Developer Tools
```

Or use Docker for the backend:

```bash
docker compose up
```

See [`plugin/`](plugin/) for full documentation.

---

## Web (Desktop / Browser)

The web version is a standalone Next.js + Tauri desktop app with a built-in video editor and AI chat interface.

### Quick Start

```bash
# 1. Start the backend
cd backend
cp .env.example .env        # Add your API keys
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py

# 2. Start the web app (in a new terminal)
cd web
npm install
npm run dev
```

Then open [http://localhost:3002](http://localhost:3002).

See [`web/`](web/) for full documentation.

---

## License

Apache 2.0 - See [LICENSE](LICENSE)
