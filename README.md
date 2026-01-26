# ChatCut

An AI-powered video editing assistant for Adobe Premiere Pro. Use natural language commands to edit your videos.

## Overview

ChatCut is a UXP plugin for Premiere Pro that lets you:
- **Edit with natural language**: "zoom in by 120%", "fade in over 2 seconds"
- **Ask questions**: Get help with Premiere Pro features and workflows
- **AI video effects** (via Colab): "zoom in on the person in the gray shirt", "blur the background"

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   Premiere Pro          │     │   Python Backend        │
│   (UXP Plugin)          │────▶│   (FastAPI)             │
│   React Frontend        │     │   Port 3001             │
└─────────────────────────┘     └───────────┬─────────────┘
                                            │
                                            ▼ (optional)
                                ┌─────────────────────────┐
                                │   Google Colab          │
                                │   (GPU Processing)      │
                                └─────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Adobe Premiere Pro** 2025 (v25.5+)
- **Python** 3.9+
- **Node.js** 16+
- **Adobe UXP Developer Tools** ([Download](https://developer.adobe.com/photoshop/uxp/devtool/))
- **Gemini API Key** ([Get one free](https://aistudio.google.com/apikey))

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/dzymachine/ChatCut-2.0.git
cd ChatCut-2.0
```

---

## Step 2: Backend Setup

### 2.1 Create a virtual environment (recommended)

```bash
cd backend
python -m venv venv

# Activate it:
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate
```

### 2.2 Install dependencies

```bash
pip install -r requirements.txt
```

### 2.3 Configure environment variables

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and add your Gemini API key
```

Your `.env` file should contain:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2.4 Start the backend server

```bash
python main.py
```

You should see:
```
Starting ChatCut Backend on http://127.0.0.1:3001
```

Keep this terminal running.

---

## Step 3: Frontend Setup

Open a new terminal:

### 3.1 Install dependencies

```bash
cd frontend
npm install
```

### 3.2 Build the plugin

```bash
npm run build
```

This creates the `dist/` folder with the compiled plugin.

### 3.3 (Optional) Watch for changes during development

```bash
npm run watch
```

---

## Step 4: Load Plugin in Premiere Pro

### 4.1 Install UXP Developer Tools

1. Download from [Adobe Developer](https://developer.adobe.com/photoshop/uxp/devtool/)
2. Install and launch the UXP Developer Tools app

### 4.2 Load the plugin

1. Open **UXP Developer Tools**
2. Click **Add Plugin**
3. Navigate to `frontend/dist/manifest.json`
4. Click **Load**
5. Open **Premiere Pro**
6. Go to **Window > ChatCut** to open the panel

---

## Step 5: Verify Connection

1. Make sure the backend is running (`python main.py`)
2. In the ChatCut panel, you should see a connection indicator
3. Try typing "hello" - you should get an AI response

---

## Usage

### Basic Editing Commands

| Command | Action |
|---------|--------|
| `zoom in by 120%` | Scale the clip to 120% |
| `fade in over 1 second` | Add a 1s fade-in transition |
| `set opacity to 50%` | Adjust clip opacity |
| `speed up 2x` | Double the playback speed |
| `add cross dissolve` | Add a dissolve transition |

### Questions Mode

Switch to "Questions" mode to ask about Premiere Pro:
- "How do I export for YouTube?"
- "What's the shortcut for ripple delete?"
- "How do I color correct footage?"

### AI Video Effects (Colab)

For advanced AI-powered effects like object tracking:

1. Follow the [Colab Guide](COLAB_GUIDE.md) to set up the GPU server
2. Connect ChatCut to your Colab URL
3. Use commands like:
   - `zoom in on the person in the gray shirt`
   - `blur the background`
   - `spotlight the speaker`

---

## Project Structure

```
ChatCut/
├── backend/                 # Python FastAPI server
│   ├── main.py             # API endpoints
│   ├── requirements.txt    # Python dependencies
│   ├── services/           # AI providers & business logic
│   │   ├── ai_service.py   # Main AI processing
│   │   ├── providers/      # AI provider implementations
│   │   └── question_service.py
│   └── tests/              # Backend tests
│
├── frontend/               # React UXP plugin
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # React hooks
│   │   ├── services/       # Backend client & editing actions
│   │   └── panels/         # Main App panel
│   ├── plugin/             # UXP plugin config
│   │   └── manifest.json   # Plugin manifest
│   └── dist/               # Built plugin (generated)
│
├── notebooks/              # Colab notebooks for GPU processing
├── COLAB_GUIDE.md          # Guide for Colab setup
└── README.md               # This file
```

---

## Development

### Running Tests

```bash
# Backend tests
cd backend
pytest tests/ -v

# With API integration (requires GEMINI_API_KEY)
GEMINI_API_KEY=your_key pytest tests/ -v
```

### Hot Reload (Frontend)

```bash
cd frontend
npm run watch
```

Then in UXP Developer Tools, click **Reload** after each change.

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/process-prompt` | Process editing commands |
| `POST /api/ask-question` | Answer Premiere Pro questions |
| `POST /api/colab-start` | Start Colab processing job |
| `POST /api/colab-progress` | Check job progress |
| `GET /health` | Health check |

---

## Troubleshooting

### "Cannot connect to backend"
- Make sure the backend is running on port 3001
- Check that no firewall is blocking localhost:3001
- UXP requires `localhost` (not `127.0.0.1`)

### "Gemini API not configured"
- Verify your `.env` file has `GEMINI_API_KEY=your_key`
- The key should start with `AIza...`
- Restart the backend after changing `.env`

### Plugin not appearing in Premiere Pro
- Make sure you loaded it via UXP Developer Tools
- Check Premiere Pro version is 25.5+
- Try **Window > ChatCut**

### "File not found" errors
- Ensure clips are saved to disk (not in cloud storage)
- Check file paths don't contain special characters

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | (required) |
| `GEMINI_MODEL` | Model to use | `gemini-2.0-flash` |
| `AI_PROVIDER` | AI provider | `gemini` |

### Backend Port

To change the port, edit `backend/main.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=3001)  # Change 3001
```

And update `frontend/src/services/backendClient.js` to match.

---

## License

Apache 2.0 - See [LICENSE](LICENSE)
