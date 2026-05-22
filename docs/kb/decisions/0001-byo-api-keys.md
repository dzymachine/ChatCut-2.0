# ADR-0001: BYO API Keys

> **Status:** Accepted
> **Date:** 2026-05-01
> **Decided in:** `docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md` (Decision #3)

## Context

The legacy FastAPI backend held Gemini/Groq API keys server-side (`backend/.env`). Users couldn't bring their own model or key. This locked ChatCut to the operator's credits and prevented local/offline/private deployments.

## Decision

Users paste their own API key for their chosen provider (Anthropic, Groq, or Gemini) into the app settings. The webview calls each provider's API directly — Rust never touches AI requests.

- Anthropic: browser SDK with `dangerouslyAllowBrowser: true` (`web/src/lib/agent/providers/anthropic.ts`)
- Groq: OpenAI-compatible SDK (`providers/groq.ts`)
- Gemini: `@google/genai` SDK (`providers/gemini.ts`)
- Keys stored via `tauri-plugin-keyring` (desktop) or `localStorage` (web-only)
- Provider switchable at runtime via dropdown in settings — no app restart

## Consequences

- No server-side proxy needed for AI calls.
- Users are responsible for their own API costs.
- Browser-side SDK usage means API keys are visible in devtools in web mode (acceptable for single-user local tool; keyring used in Tauri desktop mode).
- Adding a new provider requires only a new adapter file conforming to the `LLMProvider` interface in `providers/index.ts`.
