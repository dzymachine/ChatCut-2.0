# Rust 2026 Modernization — Scope D (Follow-up Plan)

**Status:** Plan — not yet executed.
**Predecessor:** [Scope A — completed 2026-05-09](#scope-a-already-done) (edition 2024, `dirs-next` → `etcetera`, dead-code cleanup).
**Branch:** `chore/agentic-chat-first-sprint` (or a separate `chore/rust-scope-d` branch off it).
**Estimated effort:** 1–1.5 days for one dev. Risk: low-medium (mostly mechanical sweeps + one library bump).

---

## Why scope D, not B or C?

User decision on 2026-05-09: ship scope A this sprint (deadline 2026-05-15), come back later for the full ergonomic + framework refresh as a single batch. Bundling B + C residuals + D is cheaper than three separate passes because each lands on the same files (`mcp/mod.rs`, `export.rs`, `lib.rs`).

Note that one piece of original scope C (the `rmcp` `#[tool]` / `#[tool_router]` / `#[tool_handler]` macros) was **already adopted** by `nifty-haslett-8f492b`. Scope D below is the *residual* idiom + framework work.

---

## Scope A (already done)

Captured for context — do **not** redo:

* Cargo.toml `edition = "2024"`.
* `cargo fix --edition` applied (one closure-pattern fix in `recipe/mod.rs`).
* Replaced `dirs-next` with `etcetera` (uses `BaseStrategy::data_dir()` — XDG on Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows).
* Dropped vestigial `ChatCutError::ToolNotFound` variant and silenced the `tool_router` field lint with a doc-attribute (`#[allow(dead_code)]`).

Result: 0 compiler warnings, `cargo check` clean, no behavioural change.

---

## Scope D — work to do

### D1. Idiom sweep (scope B residual)

Target files: every Rust file under `web/src-tauri/src/`. Approach: enable the relevant Clippy 2026 lints, then walk each file once.

- [ ] `cargo clippy --all-targets -- -W clippy::manual_let_else -W clippy::redundant_closure_call -W clippy::needless_borrow -W clippy::useless_conversion`. Fix all warnings (likely <30 sites).
- [ ] Convert nested `match`-on-`Result` patterns to `?` propagation where the function already returns `Result`. Hot spots:
  - `mcp/mod.rs:144–406` — every `#[tool]` method has the same `match self.load_project() { Ok(pf) => match … { Ok(()) => match self.save_project(&pf) { … } } }` ladder. Extract a `with_project_mut<R>(&self, f: impl FnOnce(&mut ChatCutProjectFile) -> Result<R, String>) -> Result<R, String>` helper. Each tool method drops to 5–8 lines.
  - `export.rs` — multiple `match` chains that could be `?`.
- [ ] Use `let-else` for early-return guards. Hot spots:
  - `mcp/mod.rs:117–124` — `load_project`'s `ok_or_else(...)?` is fine; nothing to do here, but the pattern in `save_project` is similar.
  - Anywhere the body looks like `let foo = match x { Some(v) => v, None => return … };`.
- [ ] Use `let-chains` where current code has nested `if let` ladders. Survey `tools/mutation.rs` and `project/reader.rs`.
- [ ] Introduce a crate-level `pub type Result<T> = std::result::Result<T, ChatCutError>;` in `error.rs`. Replace `Result<…, ChatCutError>` signatures with `Result<…>` throughout `tools/mutation.rs`, `project/reader.rs`. Use `anyhow::Result<T>` only where errors are genuinely ad-hoc (`recipe/validator.rs`, `ffmpeg/probe.rs`).
- [ ] `RPITIT` where it cleans up trait signatures. Likely no callers in our crate yet — defer unless a trait surface shows up during the sweep.

### D2. Structured tool returns (scope C residual)

Currently every MCP tool method returns `String` and inlines JSON serialization + error formatting. With `rmcp >= 1.0`, tool methods can return `Result<impl IntoCallToolResult, ErrorData>` and the framework handles serialization.

- [ ] Audit `rmcp` 1.x: confirm `IntoCallToolResult` or equivalent is exposed.
- [ ] Refactor `mcp/mod.rs` tool methods to return `Result<Json<T>, McpError>` (or the rmcp-native equivalent). Eliminate the `serde_json::to_string_pretty(…).unwrap_or_else(…)` boilerplate. Each tool method drops another 3–5 lines.
- [ ] Net file size for `mcp/mod.rs`: 419 → ~250 lines expected.

### D3. axum 0.8 bump

`Cargo.toml`: `axum = "0.7"` → `"0.8"`. Used in `mcp/transport.rs` (`spawn_http`). 0.8 changes:
- Path-extractor syntax: `/users/:id` → `/users/{id}` (breaking).
- `State` extractor stricter on `Clone` bounds.
- Removed deprecated `Router::with_state` overloads.

- [ ] Update Cargo.toml.
- [ ] Run `cargo check`; fix path patterns in `mcp/transport.rs`.
- [ ] Run the HTTP transport end-to-end against an MCP smoke client (Claude Desktop or `mcp inspector`) — covered by manual QA, not unit tests.

### D4. Tracing structure

Current code uses ad-hoc `tracing::info!("…")` / `tracing::error!`. For a long-running process with concurrent tool invocations, spans make logs interpretable.

- [ ] Wrap each MCP tool entry point with `#[tracing::instrument(skip(self), fields(clip_id = %params.clip_id))]` (or appropriate field). Span fields make tool-call traces searchable.
- [ ] Wrap `export::export_video` and `recipe::validator::validate_recipe_dryrun` (the two heavy operations) in named spans.
- [ ] Keep `RUST_LOG=chatcut=info` as the default; document that `chatcut=debug` will produce per-tool spans in `docs/`.

### D5. Tighten the surface

Opportunistic — only if D1–D4 happen.

- [ ] `commands.rs` exposes Tauri commands but doesn't re-export them through a small façade module. Worth grouping if it grows beyond ~12 commands.
- [ ] `shared/extensions.rs` and `shared/mod.rs` — review whether `shared/` is actually load-bearing or a leftover scratch module.

---

## What we are NOT doing

* No module reorganization. Boundaries are fine for the current size of the crate.
* No async-runtime swap (sticking with tokio 1.x; smol/glommio aren't appropriate for a Tauri sidecar).
* No replacing `serde_json::Value` in MCP tool params — the schema-flexibility is intentional (matches `tools.json`'s `type: "object"`).
* No replacing `thiserror` / `anyhow` mix — it works, both crates are 1.x stable.

---

## Acceptance criteria

1. `cargo clippy --all-targets -- -D warnings` clean.
2. `cargo check` clean.
3. `mcp/mod.rs` line count drops by ~40% (419 → ~250).
4. An end-to-end MCP call from Claude Desktop (`get_timeline_state`, `apply_effect` with parameters, `compose_recipe`) still works against a `.chatcut` file.
5. `tracing` output at `chatcut=debug` shows nested spans for tool invocations.

---

## Open questions for the implementer

1. **Helper extraction shape**: should `with_project_mut` live on `ChatCutMcpServer` directly, or as a free function taking `&self`? Probably the former (consistent with `load_project`/`save_project`).
2. **axum 0.8 path syntax**: confirm whether the MCP transport actually uses path params or only POST `/`. If only `/`, the bump is trivial.
3. **Span field strategy**: skip `self` in instruments globally, or be selective? Default to skip.
