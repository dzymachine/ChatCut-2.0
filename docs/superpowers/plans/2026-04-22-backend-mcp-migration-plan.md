# ChatCut Backend → MCP Server Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ChatCut's bespoke FastAPI backend with an MCP server exposing a canonical, NLE-agnostic tool registry; add a Claude provider with prompt caching; keep both existing clients (UXP plugin, Tauri/Next.js desktop) working through and after the migration.

**Architecture:** Stateless HTTP server (`POST /api/turn`) plus a stdio MCP transport, both backed by a shared orchestrator that calls `AsyncLLMProvider` adapters (Claude/Gemini/Groq) over canonical tool schemas; clients run the multi-turn tool-use loop and execute tools locally.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pydantic-settings, structlog, anthropic SDK ≥ 0.40, google-generativeai, groq, mcp (Python SDK), pytest + pytest-asyncio + syrupy (golden snapshots), uv, ruff, mypy.

**Companion design doc:** `docs/superpowers/specs/2026-04-22-backend-mcp-migration-design.md` — read it once before starting; this plan implements that spec.

**Source of working code referenced inline:** the legacy backend lives at `backend/` (FastAPI) and remains in place during the migration. The new code lives at `backend/chatcut_backend/`. Once both clients have moved, a follow-up PR deletes the legacy modules.

**Implementation worktree:** Do **not** implement in the planning worktree. Spin a fresh worktree off `main` (`git worktree add .worktrees/backend-mcp <branch>`), then follow the tasks below. The using-git-worktrees skill explains the directory rules.

**Tooling baseline (run once before Task 1):**

```bash
# In the implementation worktree, at repo root:
cd backend
python --version          # expect 3.12.x — install via pyenv if needed
uv --version              # expect 0.4+; install via `pip install uv` if missing
```

If either is missing, install them; subsequent tasks assume both are present.

---

## Task index

**Phase 1 — Foundation (Week 1)**

1. Bootstrap `chatcut_backend` package skeleton
2. Settings module
3. Exception hierarchy
4. Structured logging
5. Orchestrator types (Step, ToolCall, ToolResult, Message, ContentBlock, UsageInfo)
6. Canonical tool model (`CanonicalTool`, `ToolParam`)
7. Define the 9 mutation tools
8. Define the 5 introspection tools
9. Capability profile: data shape + filter
10. Premiere capability profile (no vendor yet)
11. ChatCut capability profile
12. Tool adapter — canonical → Claude
13. Tool adapter — canonical → Gemini
14. Tool adapter — canonical → Groq
15. Tool adapter — canonical → MCP
16. Golden snapshot harness for adapters

**Phase 2 — Providers (Week 2)**

17. `AsyncLLMProvider` protocol + provider registry
18. Shared retry module
19. Shared cache module
20. Claude provider — bootstrap + `is_configured`
21. Claude provider — message conversion
22. Claude provider — `run_turn` happy path
23. Claude provider — prompt caching breakpoint
24. Claude provider — typed error handling
25. Gemini provider rewrite
26. Groq provider rewrite
27. Cross-provider contract test suite

**Phase 3 — HTTP transport + clients (Week 3)**

28. FastAPI app skeleton in `transports/http.py`
29. `POST /api/turn` endpoint
30. Legacy shim — `/api/process-prompt`
31. Legacy shim — `/api/ask-question`
32. Integrations API — port `/api/process-media`, `/api/colab-*`, `/api/process-object-tracking`
33. `GET /health` and `GET /api/debug/tools`
34. Run legacy `backend/tests/` against the new code paths
35. UXP plugin — multi-turn loop runner
36. Tauri desktop — multi-turn loop runner
37. Wire introspection tools — UXP
38. Wire introspection tools — Tauri

**Phase 4 — stdio MCP + vendor + docs (Week 4 buffer)**

39. Vendor premiere-pro-mcp schemas
40. Premiere profile referencing the vendor
41. stdio MCP transport
42. Tauri sidecar smoke test (manual)
43. README + onboarding docs

---

## Phase 1 — Foundation

### Task 1: Bootstrap `chatcut_backend` package skeleton

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.python-version`
- Create: `backend/ruff.toml`
- Create: `backend/mypy.ini`
- Create: `backend/chatcut_backend/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Write the version-import test (this is the only behavior the package has at this point)**

`backend/tests/unit/test_package.py`:

```python
def test_package_imports():
    import chatcut_backend
    assert chatcut_backend.__version__ == "0.1.0"
```

Create the parent dir first: `mkdir -p backend/tests/unit && touch backend/tests/unit/__init__.py`.

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_package.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'chatcut_backend'` (or pytest config error if pyproject.toml does not exist yet — that's fine, fix in next step).

- [ ] **Step 3: Write `pyproject.toml`**

```toml
[project]
name = "chatcut-backend"
version = "0.1.0"
description = "ChatCut MCP backend"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "structlog>=24.4",
    "anthropic>=0.40",
    "google-generativeai>=0.8.3",
    "groq>=0.11",
    "redis>=5.2",
    "mcp>=1.2",
    "httpx>=0.27",
    "python-dotenv>=1.0",
    "aiofiles>=24.1",
    "requests>=2.32",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "pytest-mock>=3.14",
    "syrupy>=4.7",
    "ruff>=0.7",
    "mypy>=1.13",
    "respx>=0.21",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

`backend/.python-version`:

```
3.12
```

`backend/ruff.toml`:

```toml
line-length = 100
target-version = "py312"

[lint]
select = ["E", "F", "I", "B", "UP", "ASYNC", "RUF"]
```

`backend/mypy.ini`:

```ini
[mypy]
python_version = 3.12
strict = True
plugins = pydantic.mypy
```

`backend/chatcut_backend/__init__.py`:

```python
__version__ = "0.1.0"
```

`backend/tests/conftest.py`:

```python
"""Pytest config shared across the suite."""
```

- [ ] **Step 4: Install and rerun**

```bash
cd backend && uv sync --all-extras
uv run pytest tests/unit/test_package.py -v
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/.python-version backend/ruff.toml backend/mypy.ini \
        backend/chatcut_backend/__init__.py backend/tests/__init__.py backend/tests/unit/__init__.py \
        backend/tests/conftest.py backend/tests/unit/test_package.py backend/uv.lock
git commit -m "feat(backend): bootstrap chatcut_backend package skeleton"
```

---

### Task 2: Settings module

**Files:**
- Create: `backend/chatcut_backend/settings.py`
- Test: `backend/tests/unit/test_settings.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_settings.py`:

```python
import os

import pytest

from chatcut_backend.settings import Settings


def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    monkeypatch.setenv("AI_PROVIDER", "claude")
    s = Settings()
    assert s.claude_api_key == "sk-test"
    assert s.ai_provider == "claude"


def test_settings_default_provider_is_claude(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    s = Settings()
    assert s.ai_provider == "claude"


def test_invalid_provider_raises(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai")
    with pytest.raises(ValueError):
        Settings()
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_settings.py -v
```

Expected: `ImportError: cannot import name 'Settings'`.

- [ ] **Step 3: Implement `settings.py`**

`backend/chatcut_backend/settings.py`:

```python
"""Typed application settings loaded from environment / .env."""
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ai_provider: Literal["claude", "gemini", "groq"] = "claude"

    claude_api_key: str | None = None
    claude_model: str = "claude-sonnet-4-7"
    claude_max_tokens_action: int = 1024
    claude_max_tokens_question: int = 800

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"

    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"

    redis_url: str = "redis://localhost:6379/0"
    redis_ttl_seconds: int = 86_400

    runway_api_key: str | None = None

    log_level: str = "INFO"
    debug_endpoints_enabled: bool = False


_singleton: Settings | None = None


def get_settings() -> Settings:
    global _singleton
    if _singleton is None:
        _singleton = Settings()
    return _singleton
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_settings.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/settings.py backend/tests/unit/test_settings.py
git commit -m "feat(backend): typed Settings via pydantic-settings"
```

---

### Task 3: Exception hierarchy

**Files:**
- Create: `backend/chatcut_backend/exceptions.py`
- Test: `backend/tests/unit/test_exceptions.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_exceptions.py`:

```python
from chatcut_backend.exceptions import (
    ChatCutError,
    ProviderError,
    RateLimitError,
    TransientError,
    ToolError,
    ValidationError,
)


def test_hierarchy():
    assert issubclass(ProviderError, ChatCutError)
    assert issubclass(RateLimitError, ProviderError)
    assert issubclass(TransientError, ProviderError)
    assert issubclass(ToolError, ChatCutError)
    assert issubclass(ValidationError, ChatCutError)


def test_rate_limit_carries_retry_after():
    err = RateLimitError("rate limited", retry_after_seconds=12.5)
    assert err.retry_after_seconds == 12.5
    assert "rate limited" in str(err)


def test_provider_error_carries_provider_name():
    err = ProviderError("boom", provider="claude")
    assert err.provider == "claude"
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_exceptions.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Implement**

`backend/chatcut_backend/exceptions.py`:

```python
"""Typed exception hierarchy. Replaces substring matching across providers."""
from __future__ import annotations


class ChatCutError(Exception):
    """Base for all backend-internal errors."""


class ProviderError(ChatCutError):
    def __init__(self, message: str, *, provider: str | None = None) -> None:
        super().__init__(message)
        self.provider = provider


class RateLimitError(ProviderError):
    def __init__(
        self,
        message: str,
        *,
        provider: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message, provider=provider)
        self.retry_after_seconds = retry_after_seconds


class TransientError(ProviderError):
    """5xx, network blips, anything safe to retry."""


class ToolError(ChatCutError):
    """Raised when a tool call cannot be validated against the canonical schema."""


class ValidationError(ChatCutError):
    """Raised by the orchestrator on bad request shapes."""
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_exceptions.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/exceptions.py backend/tests/unit/test_exceptions.py
git commit -m "feat(backend): typed exception hierarchy"
```

---

### Task 4: Structured logging

**Files:**
- Create: `backend/chatcut_backend/logging.py`
- Test: `backend/tests/unit/test_logging.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_logging.py`:

```python
import json

import structlog

from chatcut_backend.logging import configure_logging, get_logger


def test_logger_emits_json(capsys):
    configure_logging(level="INFO")
    log = get_logger("test")
    log.info("hello", request_id="abc")
    captured = capsys.readouterr().out.strip()
    payload = json.loads(captured)
    assert payload["event"] == "hello"
    assert payload["request_id"] == "abc"
    assert payload["logger"] == "test"
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_logging.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/logging.py`:

```python
"""structlog configuration. Always JSON output for grep/jq friendliness."""
import logging
import sys

import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_logging.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/logging.py backend/tests/unit/test_logging.py
git commit -m "feat(backend): structlog JSON logging"
```

---

### Task 5: Orchestrator types

**Files:**
- Create: `backend/chatcut_backend/orchestrator/__init__.py`
- Create: `backend/chatcut_backend/orchestrator/types.py`
- Test: `backend/tests/unit/test_orchestrator_types.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_orchestrator_types.py`:

```python
import pytest
from pydantic import ValidationError

from chatcut_backend.orchestrator.types import (
    ContentBlock,
    Message,
    Step,
    ToolCall,
    ToolResult,
    UsageInfo,
)


def test_step_answer_round_trip():
    s = Step(type="answer", answer="ok", usage=UsageInfo(input_tokens=10, output_tokens=2))
    parsed = Step.model_validate_json(s.model_dump_json())
    assert parsed.type == "answer"
    assert parsed.answer == "ok"


def test_step_tool_calls_round_trip():
    s = Step(
        type="tool_calls",
        tool_calls=[ToolCall(id="t1", name="zoom_in", arguments={"endScale": 150})],
    )
    parsed = Step.model_validate_json(s.model_dump_json())
    assert parsed.type == "tool_calls"
    assert parsed.tool_calls[0].name == "zoom_in"


def test_message_string_content():
    m = Message(role="user", content="hello")
    assert m.content == "hello"


def test_message_block_content():
    m = Message(
        role="assistant",
        content=[
            ContentBlock(type="text", text="thinking..."),
            ContentBlock(
                type="tool_use", tool_use_id="t1", tool_name="zoom_in", input={"endScale": 200}
            ),
        ],
    )
    assert m.content[1].tool_name == "zoom_in"


def test_tool_result_default_not_error():
    tr = ToolResult(tool_call_id="t1", output={"ok": True})
    assert tr.is_error is False


def test_step_validation_rejects_missing_answer():
    with pytest.raises(ValidationError):
        Step(type="answer")  # neither answer nor tool_calls
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_orchestrator_types.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/orchestrator/__init__.py`:

```python
"""Orchestrator: provider-agnostic per-turn LLM driver."""
```

`backend/chatcut_backend/orchestrator/types.py`:

```python
"""Pydantic models that flow between the HTTP layer, providers, and clients."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ContentBlock(BaseModel):
    """Provider-neutral block for interleaved text + tool_use within an assistant message."""

    type: Literal["text", "tool_use", "tool_result"]
    text: str | None = None
    tool_use_id: str | None = None
    tool_name: str | None = None
    input: dict | None = None
    output: dict | str | None = None
    is_error: bool = False


class Message(BaseModel):
    role: Literal["user", "assistant", "tool_result"]
    content: str | list[ContentBlock]


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict


class ToolResult(BaseModel):
    tool_call_id: str
    output: dict | str
    is_error: bool = False


class UsageInfo(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    model: str | None = None


class Step(BaseModel):
    type: Literal["answer", "tool_calls"]
    answer: str | None = None
    tool_calls: list[ToolCall] | None = None
    usage: UsageInfo | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "Step":
        if self.type == "answer" and self.answer is None:
            raise ValueError("answer step must include `answer`")
        if self.type == "tool_calls" and not self.tool_calls:
            raise ValueError("tool_calls step must include at least one tool_call")
        return self


class TurnRequest(BaseModel):
    messages: list[Message]
    tool_results: list[ToolResult] | None = None
    client_type: Literal["premiere", "chatcut"]
    provider_hint: Literal["claude", "gemini", "groq"] | None = None
    cache: bool = True


TurnResponse = Step
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_orchestrator_types.py -v
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/orchestrator backend/tests/unit/test_orchestrator_types.py
git commit -m "feat(backend): Step / ToolCall / ToolResult / Message types"
```

---

### Task 6: Canonical tool model

**Files:**
- Create: `backend/chatcut_backend/registry/__init__.py`
- Create: `backend/chatcut_backend/registry/canonical.py` (model only; tools added in tasks 7-8)
- Test: `backend/tests/unit/test_canonical_model.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_canonical_model.py`:

```python
import pytest
from pydantic import ValidationError

from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def test_tool_param_minimal():
    p = ToolParam(name="x", type="number", description="x value")
    assert p.required is False
    assert p.default is None
    assert p.enum is None


def test_tool_param_with_enum():
    p = ToolParam(
        name="curve", type="string", description="curve", enum=["LINEAR", "BEZIER"]
    )
    assert p.enum == ["LINEAR", "BEZIER"]


def test_canonical_tool_minimal():
    t = CanonicalTool(
        name="zoom_in",
        description="zoom into the clip",
        category="mutation",
        params=[ToolParam(name="endScale", type="number", description="target zoom %")],
    )
    assert t.name == "zoom_in"
    assert t.params[0].name == "endScale"


def test_canonical_tool_rejects_invalid_category():
    with pytest.raises(ValidationError):
        CanonicalTool(name="x", description="x", category="weird", params=[])
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_canonical_model.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/registry/__init__.py`:

```python
"""Canonical tool registry: NLE-agnostic schemas + per-NLE capability profiles."""
```

`backend/chatcut_backend/registry/canonical.py`:

```python
"""Canonical, NLE-agnostic tool definitions. Single source of truth for all providers."""
from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field

ToolType = Literal["string", "number", "integer", "boolean", "array", "object"]
ToolCategory = Literal["mutation", "introspection", "meta"]


class ToolParam(BaseModel):
    name: str
    type: ToolType
    description: str
    required: bool = False
    default: object | None = None
    enum: list[str] | None = None
    items: dict | None = None  # JSON-Schema items spec for arrays


class CanonicalTool(BaseModel):
    name: str  # snake_case, NLE-agnostic
    description: str
    category: ToolCategory
    params: list[ToolParam] = Field(default_factory=list)
    returns: str | None = None
    examples: list[str] = Field(default_factory=list)


# Populated by tasks 7-8
CANONICAL_TOOLS: list[CanonicalTool] = []


def registry_hash(tools: list[CanonicalTool]) -> str:
    """Stable digest of the canonical registry. Used as a cache-key salt."""
    blob = json.dumps([t.model_dump() for t in tools], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_canonical_model.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry backend/tests/unit/test_canonical_model.py
git commit -m "feat(backend): CanonicalTool / ToolParam Pydantic models"
```

---

### Task 7: Define the 9 mutation tools

**Files:**
- Modify: `backend/chatcut_backend/registry/canonical.py`
- Create: `backend/chatcut_backend/registry/_mutations.py`
- Test: `backend/tests/unit/test_mutations.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_mutations.py`:

```python
from chatcut_backend.registry.canonical import CANONICAL_TOOLS

EXPECTED_MUTATION_NAMES = {
    "zoom_in",
    "zoom_out",
    "apply_filter",
    "apply_transition",
    "apply_blur",
    "modify_parameter",
    "apply_audio_filter",
    "adjust_volume",
    "ask_clarification",
}


def test_all_mutations_present():
    by_name = {t.name: t for t in CANONICAL_TOOLS if t.category == "mutation"}
    assert set(by_name) == EXPECTED_MUTATION_NAMES


def test_zoom_in_shape():
    t = next(t for t in CANONICAL_TOOLS if t.name == "zoom_in")
    p = {p.name: p for p in t.params}
    assert "endScale" in p
    assert p["endScale"].type == "number"
    assert p["endScale"].default == 150
    assert p["interpolation"].enum == ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"]


def test_apply_blur_default():
    t = next(t for t in CANONICAL_TOOLS if t.name == "apply_blur")
    p = next(p for p in t.params if p.name == "blurAmount")
    assert p.default == 50
    assert p.required is False


def test_adjust_volume_required():
    t = next(t for t in CANONICAL_TOOLS if t.name == "adjust_volume")
    p = next(p for p in t.params if p.name == "volumeDb")
    assert p.required is True


def test_ask_clarification_message_required():
    t = next(t for t in CANONICAL_TOOLS if t.name == "ask_clarification")
    p = next(p for p in t.params if p.name == "message")
    assert p.required is True
```

- [ ] **Step 2: Run, watch it fail**

```bash
cd backend && uv run pytest tests/unit/test_mutations.py -v
```

- [ ] **Step 3: Implement mutations module**

`backend/chatcut_backend/registry/_mutations.py`:

```python
"""The 9 mutation tools, ported from the legacy backend's function_schemas.py."""
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam

INTERP = ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"]


def _zoom_params(default_end: float, default_start: float) -> list[ToolParam]:
    return [
        ToolParam(name="endScale", type="number", description="Target zoom percentage (e.g., 150 = 1.5x).", default=default_end),
        ToolParam(name="startScale", type="number", description="Starting zoom percentage. Only set if user says 'from X to Y'.", default=default_start),
        ToolParam(name="animated", type="boolean", description="True for gradual zoom, false for static.", default=False),
        ToolParam(name="duration", type="number", description="Animation duration in seconds. Omit to use full clip duration."),
        ToolParam(name="startTime", type="number", description="Start time offset in seconds from clip start."),
        ToolParam(name="interpolation", type="string", description="Animation curve.", enum=INTERP),
    ]


MUTATIONS: list[CanonicalTool] = [
    CanonicalTool(
        name="zoom_in",
        description="Zoom into the active clip. Default endScale=150 if not specified.",
        category="mutation",
        params=_zoom_params(default_end=150, default_start=100),
    ),
    CanonicalTool(
        name="zoom_out",
        description="Zoom out on the active clip. Default endScale=100 if not specified.",
        category="mutation",
        params=_zoom_params(default_end=100, default_start=150),
    ),
    CanonicalTool(
        name="apply_filter",
        description=(
            "Apply a video filter/effect. Use the canonical filter id (e.g., 'black_and_white', "
            "'vignette', 'tint'); the client adapter maps to the NLE-native effect name."
        ),
        category="mutation",
        params=[
            ToolParam(name="filterName", type="string", description="Canonical filter id.", required=True),
        ],
    ),
    CanonicalTool(
        name="apply_transition",
        description="Apply a video transition between clips. Use canonical transition ids.",
        category="mutation",
        params=[
            ToolParam(name="transitionName", type="string", description="Canonical transition id.", required=True),
            ToolParam(name="duration", type="number", description="Transition duration in seconds.", default=1.0),
            ToolParam(name="applyToStart", type="boolean", description="True applies at clip start; false at end.", default=True),
        ],
    ),
    CanonicalTool(
        name="apply_blur",
        description="Apply Gaussian blur. Use this instead of apply_filter for blur requests.",
        category="mutation",
        params=[
            ToolParam(name="blurAmount", type="integer", description="Blur intensity 0-500. 25=slight, 50=normal, 100=heavy, 150+=extreme.", default=50),
        ],
    ),
    CanonicalTool(
        name="modify_parameter",
        description=(
            "Modify a numeric effect parameter on the active clip. Supports static values or animated "
            "transitions over time."
        ),
        category="mutation",
        params=[
            ToolParam(name="parameterName", type="string", description="Parameter id (canonical or NLE-native).", required=True),
            ToolParam(name="value", type="number", description="Target value (or end value if animated).", required=True),
            ToolParam(name="startValue", type="number", description="Start value for animation. Only if user says 'from X to Y'."),
            ToolParam(name="animated", type="boolean", description="True to animate the change.", default=False),
            ToolParam(name="duration", type="number", description="Animation duration in seconds."),
            ToolParam(name="startTime", type="number", description="Start time offset in seconds."),
            ToolParam(name="interpolation", type="string", description="Animation curve.", enum=INTERP),
            ToolParam(name="componentName", type="string", description="Parent effect id containing the parameter."),
        ],
    ),
    CanonicalTool(
        name="apply_audio_filter",
        description="Apply an audio effect (reverb, EQ, compressor, etc).",
        category="mutation",
        params=[
            ToolParam(name="filterName", type="string", description="Canonical audio filter id.", required=True),
        ],
    ),
    CanonicalTool(
        name="adjust_volume",
        description="Adjust audio volume in decibels. Default +3 for 'louder', -3 for 'quieter', ±6 for 'much louder/quieter'.",
        category="mutation",
        params=[
            ToolParam(name="volumeDb", type="number", description="Volume change in decibels.", required=True),
        ],
    ),
    CanonicalTool(
        name="ask_clarification",
        description="Use when the request is ambiguous, when greeting/small-talk, or when multiple options match.",
        category="meta",  # categorised as meta but kept in mutation list for parity (see spec section 6.2)
        params=[
            ToolParam(name="message", type="string", description="Friendly message to show the user.", required=True),
            ToolParam(name="suggestions", type="array", description="Optional list of options.", items={"type": "string"}),
        ],
    ),
]
```

`backend/chatcut_backend/registry/canonical.py` — replace the `CANONICAL_TOOLS: list[CanonicalTool] = []` line with:

```python
from chatcut_backend.registry._mutations import MUTATIONS  # noqa: E402

CANONICAL_TOOLS: list[CanonicalTool] = list(MUTATIONS)
```

(Note: `ask_clarification` is `category="meta"` per spec — the test expects it among "mutation" names because it lives in the `EXPECTED_MUTATION_NAMES` set. Adjust the test assertion to allow `category in {"mutation", "meta"}` for `ask_clarification`. Re-write the failing test:)

```python
def test_all_mutations_present():
    by_name = {t.name: t for t in CANONICAL_TOOLS if t.category in {"mutation", "meta"}}
    assert set(by_name) >= EXPECTED_MUTATION_NAMES
```

- [ ] **Step 4: Run, watch it pass**

```bash
cd backend && uv run pytest tests/unit/test_mutations.py -v
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry backend/tests/unit/test_mutations.py
git commit -m "feat(backend): canonical mutation tools (9 actions)"
```

---

### Task 8: Define the 5 introspection tools

**Files:**
- Create: `backend/chatcut_backend/registry/_introspection.py`
- Modify: `backend/chatcut_backend/registry/canonical.py`
- Test: `backend/tests/unit/test_introspection.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_introspection.py`:

```python
from chatcut_backend.registry.canonical import CANONICAL_TOOLS

EXPECTED = {
    "get_selected_clips",
    "get_clip_parameters",
    "get_active_sequence_info",
    "get_playhead_position",
    "list_applied_effects",
}


def test_introspection_tools_present():
    by_name = {t.name: t for t in CANONICAL_TOOLS if t.category == "introspection"}
    assert set(by_name) == EXPECTED


def test_get_clip_parameters_requires_clip_id():
    t = next(t for t in CANONICAL_TOOLS if t.name == "get_clip_parameters")
    p = next(p for p in t.params if p.name == "clipId")
    assert p.required is True


def test_get_selected_clips_no_required_params():
    t = next(t for t in CANONICAL_TOOLS if t.name == "get_selected_clips")
    assert all(p.required is False for p in t.params)


def test_introspection_tools_describe_returns():
    for name in EXPECTED:
        t = next(t for t in CANONICAL_TOOLS if t.name == name)
        assert t.returns is not None and len(t.returns) > 10
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_introspection.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/registry/_introspection.py`:

```python
"""The 5 read-only introspection tools added in this migration."""
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam

INTROSPECTION: list[CanonicalTool] = [
    CanonicalTool(
        name="get_selected_clips",
        description="Return the ids and basic metadata of all clips currently selected in the active sequence.",
        category="introspection",
        params=[],
        returns="Array of {clip_id, name, track_index, in_point_seconds, out_point_seconds, source_path}.",
    ),
    CanonicalTool(
        name="get_clip_parameters",
        description="Given a clip id, return the currently-applied effects and their parameter values.",
        category="introspection",
        params=[
            ToolParam(name="clipId", type="string", description="Clip id (from get_selected_clips).", required=True),
        ],
        returns="Array of {effect_id, display_name, parameters: {name: value}}.",
    ),
    CanonicalTool(
        name="get_active_sequence_info",
        description="Return the active sequence's dimensions, fps, total duration, and track counts.",
        category="introspection",
        params=[],
        returns="{width, height, fps, duration_seconds, video_track_count, audio_track_count, name}.",
    ),
    CanonicalTool(
        name="get_playhead_position",
        description="Return the current playhead position in seconds and frames.",
        category="introspection",
        params=[],
        returns="{seconds: float, frames: int, fps: float}.",
    ),
    CanonicalTool(
        name="list_applied_effects",
        description="Given a clip id, return a flat list of effects with display names (no parameter values).",
        category="introspection",
        params=[
            ToolParam(name="clipId", type="string", description="Clip id (from get_selected_clips).", required=True),
        ],
        returns="Array of {effect_id, display_name, category}.",
    ),
]
```

Append to `backend/chatcut_backend/registry/canonical.py` (after the existing `CANONICAL_TOOLS` line):

```python
from chatcut_backend.registry._introspection import INTROSPECTION  # noqa: E402

CANONICAL_TOOLS.extend(INTROSPECTION)
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/unit/test_introspection.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry backend/tests/unit/test_introspection.py
git commit -m "feat(backend): canonical introspection tools (5 read-only)"
```

---

### Task 9: Capability profile shape + filter

**Files:**
- Create: `backend/chatcut_backend/registry/profiles/__init__.py`
- Create: `backend/chatcut_backend/registry/filters.py`
- Test: `backend/tests/unit/test_profile_filter.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_profile_filter.py`:

```python
import pytest

from chatcut_backend.registry.canonical import CanonicalTool, ToolParam
from chatcut_backend.registry.filters import CapabilityProfile, filter_for_profile


def make_tools() -> list[CanonicalTool]:
    return [
        CanonicalTool(name="zoom_in", description="x", category="mutation", params=[]),
        CanonicalTool(name="apply_audio_filter", description="x", category="mutation", params=[]),
        CanonicalTool(name="get_selected_clips", description="x", category="introspection", params=[]),
    ]


def test_filter_returns_only_supported():
    profile = CapabilityProfile(
        id="chatcut",
        supported={"zoom_in": None, "get_selected_clips": None},
        excluded=set(),
        translations={},
    )
    out = filter_for_profile(make_tools(), profile)
    names = {t.name for t in out}
    assert names == {"zoom_in", "get_selected_clips"}


def test_excluded_overrides_supported():
    profile = CapabilityProfile(
        id="chatcut",
        supported={"zoom_in": None, "apply_audio_filter": None},
        excluded={"apply_audio_filter"},
        translations={},
    )
    out = filter_for_profile(make_tools(), profile)
    assert {t.name for t in out} == {"zoom_in"}


def test_unknown_profile_id_raises():
    with pytest.raises(ValueError):
        filter_for_profile(make_tools(), None)
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_profile_filter.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/registry/profiles/__init__.py`:

```python
"""Per-NLE capability profiles."""
```

`backend/chatcut_backend/registry/filters.py`:

```python
"""Capability profile data shape + canonical-tool filter."""
from __future__ import annotations

from pydantic import BaseModel, Field

from chatcut_backend.registry.canonical import CanonicalTool


class CapabilityProfile(BaseModel):
    id: str
    supported: dict[str, str | None] = Field(default_factory=dict)
    """Map: canonical tool name -> NLE-native id (or None to pass through)."""
    excluded: set[str] = Field(default_factory=set)
    """Canonical tool names the LLM should never see for this NLE."""
    translations: dict[str, dict[str, str]] = Field(default_factory=dict)
    """Per-tool argument translations: {tool_name: {canonical_value: nle_value}}."""


def filter_for_profile(
    tools: list[CanonicalTool], profile: CapabilityProfile | None
) -> list[CanonicalTool]:
    if profile is None:
        raise ValueError("profile is required")
    return [
        t for t in tools
        if t.name in profile.supported and t.name not in profile.excluded
    ]
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/unit/test_profile_filter.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry/profiles backend/chatcut_backend/registry/filters.py \
        backend/tests/unit/test_profile_filter.py
git commit -m "feat(backend): CapabilityProfile + filter_for_profile"
```

---

### Task 10: Premiere capability profile (no vendor yet)

**Files:**
- Create: `backend/chatcut_backend/registry/profiles/premiere.py`
- Test: `backend/tests/unit/test_premiere_profile.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_premiere_profile.py`:

```python
from chatcut_backend.registry.canonical import CANONICAL_TOOLS
from chatcut_backend.registry.filters import filter_for_profile
from chatcut_backend.registry.profiles.premiere import PREMIERE_PROFILE


def test_premiere_supports_all_14():
    out = filter_for_profile(CANONICAL_TOOLS, PREMIERE_PROFILE)
    assert {t.name for t in out} == {
        "zoom_in", "zoom_out", "apply_filter", "apply_transition", "apply_blur",
        "modify_parameter", "apply_audio_filter", "adjust_volume", "ask_clarification",
        "get_selected_clips", "get_clip_parameters", "get_active_sequence_info",
        "get_playhead_position", "list_applied_effects",
    }


def test_apply_blur_translates_to_match_name():
    assert PREMIERE_PROFILE.supported["apply_blur"] == "AE.ADBE Gaussian Blur 2"
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_premiere_profile.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/registry/profiles/premiere.py`:

```python
"""Premiere Pro capability profile.

For the May 15 surface, all 14 canonical tools are supported. The vendor module
(see Task 39) will later replace these mappings with the upstream premiere-pro-mcp
schemas; for now we bind canonical names to Premiere matchNames inline.
"""
from chatcut_backend.registry.filters import CapabilityProfile

PREMIERE_PROFILE = CapabilityProfile(
    id="premiere",
    supported={
        # mutations
        "zoom_in": "ADBE Scale",
        "zoom_out": "ADBE Scale",
        "apply_filter": None,            # filterName carries the matchName already
        "apply_transition": None,
        "apply_blur": "AE.ADBE Gaussian Blur 2",
        "modify_parameter": None,
        "apply_audio_filter": None,
        "adjust_volume": None,
        "ask_clarification": None,
        # introspection
        "get_selected_clips": None,
        "get_clip_parameters": None,
        "get_active_sequence_info": None,
        "get_playhead_position": None,
        "list_applied_effects": None,
    },
    excluded=set(),
    translations={},
)
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/unit/test_premiere_profile.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry/profiles/premiere.py \
        backend/tests/unit/test_premiere_profile.py
git commit -m "feat(backend): Premiere capability profile (pre-vendor)"
```

---

### Task 11: ChatCut capability profile

**Files:**
- Create: `backend/chatcut_backend/registry/profiles/chatcut.py`
- Test: `backend/tests/unit/test_chatcut_profile.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_chatcut_profile.py`:

```python
from chatcut_backend.registry.canonical import CANONICAL_TOOLS
from chatcut_backend.registry.filters import filter_for_profile
from chatcut_backend.registry.profiles.chatcut import CHATCUT_PROFILE


def test_chatcut_excludes_audio_filter_for_now():
    out = {t.name for t in filter_for_profile(CANONICAL_TOOLS, CHATCUT_PROFILE)}
    assert "apply_audio_filter" not in out
    assert "zoom_in" in out
    assert "get_selected_clips" in out


def test_chatcut_translates_apply_blur():
    assert CHATCUT_PROFILE.supported["apply_blur"] == "gaussian_blur"
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_chatcut_profile.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/registry/profiles/chatcut.py`:

```python
"""ChatCut desktop (Tauri) capability profile.

Effect ids correspond to entries in `web/src/lib/effects/registry.ts`. The
`apply_audio_filter` tool is excluded for the May 15 surface — the Tauri ffmpeg
audio path lacks an effect-style abstraction (see spec Section 14, item 1).
"""
from chatcut_backend.registry.filters import CapabilityProfile

CHATCUT_PROFILE = CapabilityProfile(
    id="chatcut",
    supported={
        # mutations
        "zoom_in": "scale",
        "zoom_out": "scale",
        "apply_filter": None,
        "apply_transition": None,
        "apply_blur": "gaussian_blur",
        "modify_parameter": None,
        "adjust_volume": None,           # Tauri export.rs supports per-clip dB adjust
        "ask_clarification": None,
        # introspection
        "get_selected_clips": None,
        "get_clip_parameters": None,
        "get_active_sequence_info": None,
        "get_playhead_position": None,
        "list_applied_effects": None,
    },
    excluded={"apply_audio_filter"},
    translations={
        # canonical "vignette" -> chatcut effect id; expand as registry grows
        "apply_filter": {
            "vignette": "vignette",
            "sepia": "sepia",
            "grayscale": "grayscale",
            "sharpen": "sharpen",
        },
    },
)
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry/profiles/chatcut.py \
        backend/tests/unit/test_chatcut_profile.py
git commit -m "feat(backend): ChatCut capability profile"
```

---

### Task 12: Tool adapter — canonical → Claude

**Files:**
- Create: `backend/chatcut_backend/llm/__init__.py`
- Create: `backend/chatcut_backend/llm/_shared/__init__.py`
- Create: `backend/chatcut_backend/llm/_shared/tool_adapters.py`
- Test: `backend/tests/unit/test_tool_adapter_claude.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_tool_adapter_claude.py`:

```python
from chatcut_backend.llm._shared.tool_adapters import canonical_to_claude
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def test_simple_tool_to_claude():
    tool = CanonicalTool(
        name="zoom_in",
        description="zoom into clip",
        category="mutation",
        params=[
            ToolParam(name="endScale", type="number", description="target zoom %", default=150),
            ToolParam(name="animated", type="boolean", description="gradual or static", default=False),
        ],
    )
    out = canonical_to_claude([tool])
    assert out == [
        {
            "name": "zoom_in",
            "description": "zoom into clip",
            "input_schema": {
                "type": "object",
                "properties": {
                    "endScale": {"type": "number", "description": "target zoom %", "default": 150},
                    "animated": {"type": "boolean", "description": "gradual or static", "default": False},
                },
                "required": [],
            },
        }
    ]


def test_required_and_enum():
    tool = CanonicalTool(
        name="modify_parameter",
        description="set a numeric parameter",
        category="mutation",
        params=[
            ToolParam(name="parameterName", type="string", description="param id", required=True),
            ToolParam(name="value", type="number", description="target value", required=True),
            ToolParam(
                name="interpolation", type="string", description="curve",
                enum=["LINEAR", "BEZIER"],
            ),
        ],
    )
    schema = canonical_to_claude([tool])[0]["input_schema"]
    assert schema["required"] == ["parameterName", "value"]
    assert schema["properties"]["interpolation"]["enum"] == ["LINEAR", "BEZIER"]


def test_array_with_items():
    tool = CanonicalTool(
        name="ask_clarification",
        description="ask user",
        category="meta",
        params=[
            ToolParam(name="message", type="string", description="text", required=True),
            ToolParam(name="suggestions", type="array", description="options", items={"type": "string"}),
        ],
    )
    schema = canonical_to_claude([tool])[0]["input_schema"]
    assert schema["properties"]["suggestions"] == {
        "type": "array",
        "description": "options",
        "items": {"type": "string"},
    }
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_tool_adapter_claude.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/__init__.py`:

```python
"""LLM provider adapters."""
```

`backend/chatcut_backend/llm/_shared/__init__.py`:

```python
"""Provider-shared helpers (retry, cache, schema adapters)."""
```

`backend/chatcut_backend/llm/_shared/tool_adapters.py`:

```python
"""Pure functions converting canonical tool defs to per-provider formats.

No I/O. Each adapter has a golden snapshot test (Task 16).
"""
from __future__ import annotations

from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def _param_to_json_schema(p: ToolParam) -> dict:
    out: dict = {"type": p.type, "description": p.description}
    if p.default is not None:
        out["default"] = p.default
    if p.enum is not None:
        out["enum"] = p.enum
    if p.items is not None:
        out["items"] = p.items
    return out


def _input_schema(tool: CanonicalTool) -> dict:
    return {
        "type": "object",
        "properties": {p.name: _param_to_json_schema(p) for p in tool.params},
        "required": [p.name for p in tool.params if p.required],
    }


def canonical_to_claude(tools: list[CanonicalTool]) -> list[dict]:
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": _input_schema(t),
        }
        for t in tools
    ]
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/unit/test_tool_adapter_claude.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm backend/tests/unit/test_tool_adapter_claude.py
git commit -m "feat(backend): canonical -> Claude tool adapter"
```

---

### Task 13: Tool adapter — canonical → Gemini

**Files:**
- Modify: `backend/chatcut_backend/llm/_shared/tool_adapters.py`
- Test: `backend/tests/unit/test_tool_adapter_gemini.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_tool_adapter_gemini.py`:

```python
from chatcut_backend.llm._shared.tool_adapters import canonical_to_gemini
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def test_gemini_wraps_in_function_declarations():
    tool = CanonicalTool(
        name="adjust_volume",
        description="set volume in dB",
        category="mutation",
        params=[ToolParam(name="volumeDb", type="number", description="dB", required=True)],
    )
    out = canonical_to_gemini([tool])
    assert out == [
        {
            "function_declarations": [
                {
                    "name": "adjust_volume",
                    "description": "set volume in dB",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "volumeDb": {"type": "number", "description": "dB"},
                        },
                        "required": ["volumeDb"],
                    },
                }
            ]
        }
    ]


def test_gemini_strips_default_field():
    """Gemini's function-call API rejects `default` on parameter schemas."""
    tool = CanonicalTool(
        name="zoom_in", description="zoom",
        category="mutation",
        params=[ToolParam(name="endScale", type="number", description="zoom %", default=150)],
    )
    schema = canonical_to_gemini([tool])[0]["function_declarations"][0]["parameters"]
    assert "default" not in schema["properties"]["endScale"]
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_tool_adapter_gemini.py -v
```

- [ ] **Step 3: Append to `tool_adapters.py`**

```python
def _param_to_gemini_schema(p: ToolParam) -> dict:
    """Gemini's function-calling API doesn't accept `default`."""
    out: dict = {"type": p.type, "description": p.description}
    if p.enum is not None:
        out["enum"] = p.enum
    if p.items is not None:
        out["items"] = p.items
    return out


def canonical_to_gemini(tools: list[CanonicalTool]) -> list[dict]:
    return [
        {
            "function_declarations": [
                {
                    "name": t.name,
                    "description": t.description,
                    "parameters": {
                        "type": "object",
                        "properties": {p.name: _param_to_gemini_schema(p) for p in t.params},
                        "required": [p.name for p in t.params if p.required],
                    },
                }
            ]
        }
        for t in tools
    ]
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/_shared/tool_adapters.py \
        backend/tests/unit/test_tool_adapter_gemini.py
git commit -m "feat(backend): canonical -> Gemini tool adapter"
```

---

### Task 14: Tool adapter — canonical → Groq

**Files:**
- Modify: `backend/chatcut_backend/llm/_shared/tool_adapters.py`
- Test: `backend/tests/unit/test_tool_adapter_groq.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_tool_adapter_groq.py`:

```python
from chatcut_backend.llm._shared.tool_adapters import canonical_to_groq
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def test_groq_uses_openai_function_shape():
    tool = CanonicalTool(
        name="zoom_in",
        description="zoom in",
        category="mutation",
        params=[
            ToolParam(name="endScale", type="number", description="zoom %", default=150),
        ],
    )
    out = canonical_to_groq([tool])
    assert out == [
        {
            "type": "function",
            "function": {
                "name": "zoom_in",
                "description": "zoom in",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endScale": {"type": "number", "description": "zoom %", "default": 150},
                    },
                    "required": [],
                },
            },
        }
    ]
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Append**

```python
def canonical_to_groq(tools: list[CanonicalTool]) -> list[dict]:
    """OpenAI-compatible tools shape (Groq accepts this verbatim)."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": _input_schema(t),
            },
        }
        for t in tools
    ]
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/_shared/tool_adapters.py \
        backend/tests/unit/test_tool_adapter_groq.py
git commit -m "feat(backend): canonical -> Groq tool adapter"
```

---

### Task 15: Tool adapter — canonical → MCP

**Files:**
- Modify: `backend/chatcut_backend/llm/_shared/tool_adapters.py`
- Test: `backend/tests/unit/test_tool_adapter_mcp.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_tool_adapter_mcp.py`:

```python
from chatcut_backend.llm._shared.tool_adapters import canonical_to_mcp
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


def test_mcp_tool_returns_mcp_types():
    import mcp.types as mcp_types

    tool = CanonicalTool(
        name="get_playhead_position",
        description="current playhead",
        category="introspection",
        params=[],
    )
    out = canonical_to_mcp([tool])
    assert isinstance(out[0], mcp_types.Tool)
    assert out[0].name == "get_playhead_position"
    assert out[0].inputSchema == {"type": "object", "properties": {}, "required": []}
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Append**

```python
def canonical_to_mcp(tools: list[CanonicalTool]):  # type: ignore[no-untyped-def]
    """Returns a list of `mcp.types.Tool` for the stdio MCP transport."""
    import mcp.types as mcp_types  # local import; mcp is heavy

    return [
        mcp_types.Tool(
            name=t.name,
            description=t.description,
            inputSchema=_input_schema(t),
        )
        for t in tools
    ]
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/_shared/tool_adapters.py \
        backend/tests/unit/test_tool_adapter_mcp.py
git commit -m "feat(backend): canonical -> MCP tool adapter"
```

---

### Task 16: Golden snapshot harness for adapters

**Files:**
- Create: `backend/tests/golden/__init__.py`
- Create: `backend/tests/golden/test_golden_adapters.py`
- Create: `backend/tests/golden/__snapshots__/` (auto-generated)

- [ ] **Step 1: Write the snapshot test**

`backend/tests/golden/test_golden_adapters.py`:

```python
"""Snapshot tests: any change to canonical schemas must surface as a deliberate diff."""
from chatcut_backend.llm._shared.tool_adapters import (
    canonical_to_claude,
    canonical_to_gemini,
    canonical_to_groq,
)
from chatcut_backend.registry.canonical import CANONICAL_TOOLS


def test_claude_schema_snapshot(snapshot):
    out = canonical_to_claude(CANONICAL_TOOLS)
    assert out == snapshot


def test_gemini_schema_snapshot(snapshot):
    out = canonical_to_gemini(CANONICAL_TOOLS)
    assert out == snapshot


def test_groq_schema_snapshot(snapshot):
    out = canonical_to_groq(CANONICAL_TOOLS)
    assert out == snapshot
```

- [ ] **Step 2: Generate the initial snapshots**

```bash
cd backend && uv run pytest tests/golden/test_golden_adapters.py --snapshot-update -v
```

Expected output: 3 snapshots created.

- [ ] **Step 3: Re-run without `--snapshot-update` to confirm green baseline**

```bash
cd backend && uv run pytest tests/golden/test_golden_adapters.py -v
```

Expected: PASS (3 tests).

- [ ] **Step 4: Inspect the generated snapshot to make sure it looks right**

```bash
cd backend && ls tests/golden/__snapshots__/
```

You should see `test_golden_adapters.ambr` with all three provider schemas. Open it and confirm: 14 tools per provider, no obvious garbage.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/golden
git commit -m "test(backend): golden snapshots for tool schema adapters"
```

---

## Phase 2 — Providers

### Task 17: `AsyncLLMProvider` protocol + provider registry

**Files:**
- Create: `backend/chatcut_backend/llm/base.py`
- Test: `backend/tests/unit/test_provider_protocol.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_provider_protocol.py`:

```python
from typing import get_type_hints

import pytest

from chatcut_backend.llm.base import AsyncLLMProvider, get_provider


def test_protocol_signature():
    hints = get_type_hints(AsyncLLMProvider.run_turn)
    assert "messages" in hints
    assert "tools" in hints
    assert "tool_results" in hints
    assert "system_prompt" in hints
    assert "cache" in hints


def test_get_provider_unknown_raises():
    with pytest.raises(ValueError, match="unknown provider"):
        get_provider("openai")
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_provider_protocol.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/base.py`:

```python
"""AsyncLLMProvider protocol and registry."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from chatcut_backend.orchestrator.types import Message, Step, ToolResult
from chatcut_backend.registry.canonical import CanonicalTool


@runtime_checkable
class AsyncLLMProvider(Protocol):
    name: str

    async def is_configured(self) -> bool:
        ...

    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,
    ) -> Step:
        ...


_REGISTRY: dict[str, AsyncLLMProvider] = {}


def register_provider(name: str, provider: AsyncLLMProvider) -> None:
    _REGISTRY[name] = provider


def get_provider(name: str) -> AsyncLLMProvider:
    if name not in _REGISTRY:
        raise ValueError(f"unknown provider: {name}")
    return _REGISTRY[name]


def list_providers() -> list[str]:
    return sorted(_REGISTRY)
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/base.py backend/tests/unit/test_provider_protocol.py
git commit -m "feat(backend): AsyncLLMProvider protocol + registry"
```

---

### Task 18: Shared retry module

**Files:**
- Create: `backend/chatcut_backend/llm/_shared/retry.py`
- Test: `backend/tests/unit/test_retry.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_retry.py`:

```python
import asyncio

import pytest

from chatcut_backend.exceptions import ProviderError, RateLimitError, TransientError
from chatcut_backend.llm._shared.retry import async_retry


@pytest.mark.asyncio
async def test_retry_on_transient_then_succeed():
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise TransientError("blip", provider="x")
        return "ok"

    out = await async_retry(flaky, max_attempts=5, base_delay=0.0)
    assert out == "ok"
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_retry_respects_rate_limit_retry_after():
    calls = {"n": 0, "delays": []}

    async def sleep_spy(d):
        calls["delays"].append(d)

    async def hits_limit_once():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RateLimitError("slow down", provider="x", retry_after_seconds=0.5)
        return "ok"

    out = await async_retry(hits_limit_once, max_attempts=3, base_delay=0.0, sleep=sleep_spy)
    assert out == "ok"
    assert calls["delays"] == [0.5]


@pytest.mark.asyncio
async def test_non_provider_error_propagates_immediately():
    async def boom():
        raise RuntimeError("not a provider error")

    with pytest.raises(RuntimeError):
        await async_retry(boom, max_attempts=3, base_delay=0.0)


@pytest.mark.asyncio
async def test_max_attempts_raises_last_error():
    async def always_transient():
        raise TransientError("nope", provider="x")

    with pytest.raises(TransientError):
        await async_retry(always_transient, max_attempts=2, base_delay=0.0)
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_retry.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/_shared/retry.py`:

```python
"""Async exponential-backoff retry with typed exception handling."""
from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

from chatcut_backend.exceptions import ProviderError, RateLimitError, TransientError

T = TypeVar("T")


async def async_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = 4,
    base_delay: float = 0.5,
    max_delay: float = 30.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except RateLimitError as e:
            last_err = e
            delay = e.retry_after_seconds if e.retry_after_seconds is not None else _backoff(attempt, base_delay, max_delay)
        except TransientError as e:
            last_err = e
            delay = _backoff(attempt, base_delay, max_delay)
        except ProviderError:
            raise
        if attempt < max_attempts:
            await sleep(delay)
    assert last_err is not None
    raise last_err


def _backoff(attempt: int, base: float, cap: float) -> float:
    raw = min(cap, base * (2 ** (attempt - 1)))
    return raw * (0.5 + random.random() / 2)  # ±25% jitter
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/_shared/retry.py backend/tests/unit/test_retry.py
git commit -m "feat(backend): typed async retry with backoff + jitter"
```

---

### Task 19: Shared cache module

**Files:**
- Create: `backend/chatcut_backend/llm/_shared/cache.py`
- Test: `backend/tests/unit/test_cache.py`

- [ ] **Step 1: Failing test**

`backend/tests/unit/test_cache.py`:

```python
import pytest

from chatcut_backend.llm._shared.cache import ProviderCache


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def get(self, k):
        return self.store.get(k)

    def setex(self, k, ttl, v):
        self.store[k] = v
        return True

    def ping(self):
        return True


def test_cache_key_includes_provider_and_registry_hash():
    c = ProviderCache(client=_FakeRedis(), provider="claude", registry_hash="abc123")
    k1 = c._key("hello", {"client_type": "premiere"})
    c2 = ProviderCache(client=_FakeRedis(), provider="gemini", registry_hash="abc123")
    k2 = c2._key("hello", {"client_type": "premiere"})
    assert k1 != k2  # different provider must produce different key


def test_cache_set_then_get_round_trip():
    c = ProviderCache(client=_FakeRedis(), provider="claude", registry_hash="abc123")
    payload = {"type": "answer", "answer": "hello"}
    assert c.get("hi", None) is None
    c.set("hi", payload, None)
    assert c.get("hi", None) == payload


def test_cache_disabled_when_client_unavailable():
    c = ProviderCache(client=None, provider="claude", registry_hash="abc")
    assert c.get("x", None) is None
    assert c.set("x", {"a": 1}, None) is False
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/unit/test_cache.py -v
```

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/_shared/cache.py`:

```python
"""Provider-aware Redis cache. Optional — silently disabled when Redis is unavailable."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

try:
    import redis  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    redis = None  # type: ignore[assignment]


class ProviderCache:
    """Hash-keyed cache. Key incorporates provider id + registry hash + normalized prompt."""

    def __init__(
        self,
        *,
        client: object | None,
        provider: str,
        registry_hash: str,
        ttl_seconds: int = 86_400,
    ) -> None:
        self.client = client
        self.provider = provider
        self.registry_hash = registry_hash
        self.ttl_seconds = ttl_seconds

    @staticmethod
    def _normalize(prompt: str) -> str:
        text = prompt.lower().strip()
        text = re.sub(r"\s+", " ", text)
        return re.sub(r"[.!?,;:]+$", "", text).strip()

    def _key(self, prompt: str, ctx: dict[str, Any] | None) -> str:
        norm = self._normalize(prompt)
        seed = f"{self.provider}:{self.registry_hash}:{norm}:{json.dumps(ctx or {}, sort_keys=True)}"
        return f"chatcut:llm:{hashlib.md5(seed.encode()).hexdigest()}"

    def get(self, prompt: str, ctx: dict[str, Any] | None) -> dict | None:
        if self.client is None:
            return None
        try:
            raw = self.client.get(self._key(prompt, ctx))  # type: ignore[union-attr]
            return json.loads(raw) if raw else None
        except Exception:
            return None

    def set(self, prompt: str, payload: dict, ctx: dict[str, Any] | None) -> bool:
        if self.client is None:
            return False
        try:
            self.client.setex(self._key(prompt, ctx), self.ttl_seconds, json.dumps(payload))  # type: ignore[union-attr]
            return True
        except Exception:
            return False


def make_redis_client(url: str) -> object | None:
    if redis is None:  # pragma: no cover
        return None
    try:
        client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        client.ping()
        return client
    except Exception:
        return None
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/_shared/cache.py backend/tests/unit/test_cache.py
git commit -m "feat(backend): provider-aware Redis cache"
```

---

### Task 20: Claude provider — bootstrap + `is_configured`

**Files:**
- Create: `backend/chatcut_backend/llm/claude.py`
- Test: `backend/tests/providers/__init__.py`
- Test: `backend/tests/providers/test_claude_basic.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/__init__.py`:

```python
```

`backend/tests/providers/test_claude_basic.py`:

```python
import pytest

from chatcut_backend.llm.claude import ClaudeProvider


def test_claude_name():
    p = ClaudeProvider(api_key=None)
    assert p.name == "claude"


@pytest.mark.asyncio
async def test_is_configured_false_without_key():
    p = ClaudeProvider(api_key=None)
    assert await p.is_configured() is False


@pytest.mark.asyncio
async def test_is_configured_true_with_key():
    p = ClaudeProvider(api_key="sk-test")
    assert await p.is_configured() is True
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/providers/test_claude_basic.py -v
```

- [ ] **Step 3: Implement skeleton**

`backend/chatcut_backend/llm/claude.py`:

```python
"""Claude provider: anthropic SDK + tool use + prompt caching."""
from __future__ import annotations

from typing import Any

from chatcut_backend.orchestrator.types import Message, Step, ToolResult
from chatcut_backend.registry.canonical import CanonicalTool


class ClaudeProvider:
    name = "claude"

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str = "claude-sonnet-4-7",
        max_tokens: int = 1024,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self._client: Any = None

    async def is_configured(self) -> bool:
        return bool(self.api_key)

    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,
    ) -> Step:
        raise NotImplementedError("implemented in Task 22")
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/claude.py backend/tests/providers
git commit -m "feat(backend): Claude provider skeleton + is_configured"
```

---

### Task 21: Claude provider — message conversion

**Files:**
- Modify: `backend/chatcut_backend/llm/claude.py`
- Test: `backend/tests/providers/test_claude_messages.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_claude_messages.py`:

```python
from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.orchestrator.types import ContentBlock, Message, ToolResult


def _provider() -> ClaudeProvider:
    return ClaudeProvider(api_key="sk-test")


def test_simple_text_messages():
    p = _provider()
    out = p._to_anthropic_messages(
        [
            Message(role="user", content="hello"),
            Message(role="assistant", content="hi there"),
            Message(role="user", content="zoom in 200%"),
        ],
        None,
    )
    assert out == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
        {"role": "user", "content": "zoom in 200%"},
    ]


def test_assistant_tool_use_blocks_pass_through():
    p = _provider()
    msg = Message(
        role="assistant",
        content=[
            ContentBlock(type="text", text="I'll zoom in."),
            ContentBlock(
                type="tool_use",
                tool_use_id="t1",
                tool_name="zoom_in",
                input={"endScale": 200},
            ),
        ],
    )
    out = p._to_anthropic_messages([msg], None)
    assert out == [
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "I'll zoom in."},
                {"type": "tool_use", "id": "t1", "name": "zoom_in", "input": {"endScale": 200}},
            ],
        }
    ]


def test_tool_results_appended_as_user_message():
    p = _provider()
    out = p._to_anthropic_messages(
        [Message(role="user", content="zoom in")],
        [ToolResult(tool_call_id="t1", output={"ok": True})],
    )
    assert out[-1] == {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "t1",
                "content": '{"ok": true}',
                "is_error": False,
            }
        ],
    }
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement `_to_anthropic_messages`**

Append to `backend/chatcut_backend/llm/claude.py` (inside `ClaudeProvider`):

```python
    def _to_anthropic_messages(
        self,
        messages: list[Message],
        tool_results: list[ToolResult] | None,
    ) -> list[dict]:
        import json as _json

        out: list[dict] = []
        for m in messages:
            if isinstance(m.content, str):
                out.append({"role": m.role, "content": m.content})
                continue
            blocks: list[dict] = []
            for b in m.content:
                if b.type == "text":
                    blocks.append({"type": "text", "text": b.text or ""})
                elif b.type == "tool_use":
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": b.tool_use_id or "",
                            "name": b.tool_name or "",
                            "input": b.input or {},
                        }
                    )
                elif b.type == "tool_result":
                    blocks.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": b.tool_use_id or "",
                            "content": _json.dumps(b.output) if not isinstance(b.output, str) else b.output,
                            "is_error": b.is_error,
                        }
                    )
            out.append({"role": m.role, "content": blocks})

        if tool_results:
            out.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tr.tool_call_id,
                            "content": _json.dumps(tr.output) if not isinstance(tr.output, str) else tr.output,
                            "is_error": tr.is_error,
                        }
                        for tr in tool_results
                    ],
                }
            )
        return out
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/providers/test_claude_messages.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/claude.py backend/tests/providers/test_claude_messages.py
git commit -m "feat(backend): Claude provider message conversion"
```

---

### Task 22: Claude provider — `run_turn` happy path

**Files:**
- Modify: `backend/chatcut_backend/llm/claude.py`
- Test: `backend/tests/providers/test_claude_run_turn.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_claude_run_turn.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.orchestrator.types import Message
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


@pytest.mark.asyncio
async def test_run_turn_returns_text_answer():
    p = ClaudeProvider(api_key="sk-test")
    fake_resp = MagicMock()
    fake_resp.stop_reason = "end_turn"
    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "hello there"
    fake_resp.content = [fake_block]
    fake_resp.usage.input_tokens = 12
    fake_resp.usage.output_tokens = 4
    fake_resp.usage.cache_read_input_tokens = 0
    fake_resp.usage.cache_creation_input_tokens = 0

    p._client = MagicMock()
    p._client.messages.create = AsyncMock(return_value=fake_resp)

    step = await p.run_turn(
        messages=[Message(role="user", content="hi")],
        tools=[],
        system_prompt="You are a Premiere assistant.",
        cache=False,
    )

    assert step.type == "answer"
    assert step.answer == "hello there"
    assert step.usage.input_tokens == 12
    assert step.usage.output_tokens == 4


@pytest.mark.asyncio
async def test_run_turn_returns_tool_calls():
    p = ClaudeProvider(api_key="sk-test")
    fake_resp = MagicMock()
    fake_resp.stop_reason = "tool_use"
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = "I'll zoom in."
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.id = "t1"
    tool_block.name = "zoom_in"
    tool_block.input = {"endScale": 200}
    fake_resp.content = [text_block, tool_block]
    fake_resp.usage.input_tokens = 80
    fake_resp.usage.output_tokens = 20
    fake_resp.usage.cache_read_input_tokens = 0
    fake_resp.usage.cache_creation_input_tokens = 0

    p._client = MagicMock()
    p._client.messages.create = AsyncMock(return_value=fake_resp)

    tools = [
        CanonicalTool(
            name="zoom_in", description="zoom",
            category="mutation",
            params=[ToolParam(name="endScale", type="number", description="z", required=True)],
        )
    ]
    step = await p.run_turn(
        messages=[Message(role="user", content="zoom in 200%")],
        tools=tools,
        system_prompt="sys",
        cache=False,
    )

    assert step.type == "tool_calls"
    assert step.tool_calls[0].name == "zoom_in"
    assert step.tool_calls[0].arguments == {"endScale": 200}
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement `run_turn` and `_to_step`**

Replace the `NotImplementedError` body in `ClaudeProvider.run_turn` with:

```python
    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,
    ) -> Step:
        from chatcut_backend.llm._shared.tool_adapters import canonical_to_claude

        client = self._ensure_client()
        anthropic_messages = self._to_anthropic_messages(messages, tool_results)
        anthropic_tools = canonical_to_claude(tools)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": anthropic_messages,
        }
        if system_prompt:
            kwargs["system"] = self._system_blocks(system_prompt, cache)
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        response = await client.messages.create(**kwargs)
        return self._to_step(response)

    def _ensure_client(self) -> Any:
        if self._client is None:
            from anthropic import AsyncAnthropic

            self._client = AsyncAnthropic(api_key=self.api_key)
        return self._client

    def _system_blocks(self, system_prompt: str, cache: bool) -> list[dict]:
        block: dict = {"type": "text", "text": system_prompt}
        if cache:
            block["cache_control"] = {"type": "ephemeral"}
        return [block]

    def _to_step(self, response: Any) -> Step:
        from chatcut_backend.orchestrator.types import ToolCall, UsageInfo

        usage = UsageInfo(
            input_tokens=getattr(response.usage, "input_tokens", 0),
            output_tokens=getattr(response.usage, "output_tokens", 0),
            cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0),
            cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0),
            model=self.model,
        )
        tool_calls: list[ToolCall] = []
        text_parts: list[str] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(id=block.id, name=block.name, arguments=dict(block.input))
                )
        if tool_calls:
            return Step(type="tool_calls", tool_calls=tool_calls, usage=usage)
        return Step(type="answer", answer="\n".join(text_parts).strip(), usage=usage)
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/providers/test_claude_run_turn.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/claude.py backend/tests/providers/test_claude_run_turn.py
git commit -m "feat(backend): Claude provider run_turn happy path"
```

---

### Task 23: Claude provider — prompt caching breakpoint

**Files:**
- Test: `backend/tests/providers/test_claude_caching.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_claude_caching.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.orchestrator.types import Message


@pytest.mark.asyncio
async def test_cache_control_set_on_system_when_cache_true():
    p = ClaudeProvider(api_key="sk-test")
    resp = MagicMock()
    resp.stop_reason = "end_turn"
    block = MagicMock(); block.type = "text"; block.text = "ok"
    resp.content = [block]
    resp.usage.input_tokens = 1
    resp.usage.output_tokens = 1
    resp.usage.cache_read_input_tokens = 0
    resp.usage.cache_creation_input_tokens = 0
    p._client = MagicMock(); p._client.messages.create = AsyncMock(return_value=resp)

    await p.run_turn(
        messages=[Message(role="user", content="hi")],
        tools=[],
        system_prompt="x",
        cache=True,
    )

    call_kwargs = p._client.messages.create.call_args.kwargs
    assert call_kwargs["system"] == [
        {"type": "text", "text": "x", "cache_control": {"type": "ephemeral"}}
    ]


@pytest.mark.asyncio
async def test_cache_control_absent_when_cache_false():
    p = ClaudeProvider(api_key="sk-test")
    resp = MagicMock()
    resp.stop_reason = "end_turn"
    block = MagicMock(); block.type = "text"; block.text = "ok"
    resp.content = [block]
    resp.usage.input_tokens = 1
    resp.usage.output_tokens = 1
    resp.usage.cache_read_input_tokens = 0
    resp.usage.cache_creation_input_tokens = 0
    p._client = MagicMock(); p._client.messages.create = AsyncMock(return_value=resp)

    await p.run_turn(
        messages=[Message(role="user", content="hi")],
        tools=[],
        system_prompt="x",
        cache=False,
    )

    call_kwargs = p._client.messages.create.call_args.kwargs
    assert call_kwargs["system"] == [{"type": "text", "text": "x"}]
```

- [ ] **Step 2: Run, pass (the caching helper was already implemented in Task 22)**

```bash
cd backend && uv run pytest tests/providers/test_claude_caching.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/providers/test_claude_caching.py
git commit -m "test(backend): Claude prompt caching breakpoint coverage"
```

---

### Task 24: Claude provider — typed error handling

**Files:**
- Modify: `backend/chatcut_backend/llm/claude.py`
- Test: `backend/tests/providers/test_claude_errors.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_claude_errors.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.exceptions import RateLimitError, TransientError, ProviderError
from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.orchestrator.types import Message


class _FakeAnthropicRateLimit(Exception):
    def __init__(self, retry_after=None):
        self.response = MagicMock()
        self.response.headers = {"retry-after": str(retry_after)} if retry_after is not None else {}


class _FakeAnthropicAPIStatus(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code


@pytest.mark.asyncio
async def test_rate_limit_translates(monkeypatch):
    import anthropic

    monkeypatch.setattr(anthropic, "RateLimitError", _FakeAnthropicRateLimit, raising=False)

    p = ClaudeProvider(api_key="sk-test")
    p._client = MagicMock()
    p._client.messages.create = AsyncMock(side_effect=_FakeAnthropicRateLimit(retry_after=2))
    with pytest.raises(RateLimitError) as exc:
        await p.run_turn(messages=[Message(role="user", content="hi")], tools=[], system_prompt=None, cache=False)
    assert exc.value.retry_after_seconds == 2.0


@pytest.mark.asyncio
async def test_5xx_translates_to_transient(monkeypatch):
    import anthropic

    monkeypatch.setattr(anthropic, "APIStatusError", _FakeAnthropicAPIStatus, raising=False)

    p = ClaudeProvider(api_key="sk-test")
    p._client = MagicMock()
    p._client.messages.create = AsyncMock(side_effect=_FakeAnthropicAPIStatus(503))
    with pytest.raises(TransientError):
        await p.run_turn(messages=[Message(role="user", content="hi")], tools=[], system_prompt=None, cache=False)


@pytest.mark.asyncio
async def test_4xx_translates_to_provider_error(monkeypatch):
    import anthropic

    monkeypatch.setattr(anthropic, "APIStatusError", _FakeAnthropicAPIStatus, raising=False)

    p = ClaudeProvider(api_key="sk-test")
    p._client = MagicMock()
    p._client.messages.create = AsyncMock(side_effect=_FakeAnthropicAPIStatus(400))
    with pytest.raises(ProviderError):
        await p.run_turn(messages=[Message(role="user", content="hi")], tools=[], system_prompt=None, cache=False)
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Wrap the API call in `_translate_errors`**

In `ClaudeProvider.run_turn`, replace the line `response = await client.messages.create(**kwargs)` with:

```python
        response = await self._call_with_translation(client, kwargs)
```

Add this method to `ClaudeProvider`:

```python
    async def _call_with_translation(self, client: Any, kwargs: dict) -> Any:
        import anthropic

        try:
            return await client.messages.create(**kwargs)
        except anthropic.RateLimitError as e:
            retry_after = None
            try:
                retry_after = float(e.response.headers.get("retry-after"))  # type: ignore[union-attr]
            except (TypeError, ValueError, AttributeError):
                pass
            raise RateLimitError(str(e), provider=self.name, retry_after_seconds=retry_after) from e
        except anthropic.APIStatusError as e:
            status = getattr(e, "status_code", None)
            if status is not None and 500 <= status < 600:
                raise TransientError(str(e), provider=self.name) from e
            raise ProviderError(str(e), provider=self.name) from e
```

Add the imports at the top of the file:

```python
from chatcut_backend.exceptions import ProviderError, RateLimitError, TransientError
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/claude.py backend/tests/providers/test_claude_errors.py
git commit -m "feat(backend): translate anthropic errors to typed exceptions"
```

---

### Task 25: Gemini provider rewrite

**Files:**
- Create: `backend/chatcut_backend/llm/gemini.py`
- Test: `backend/tests/providers/test_gemini.py`

This task ports the existing `services/providers/gemini_provider.py` to the new shape. The legacy file is the source of truth for SDK call patterns; do not retain its retry loop or substring error matching — those live in `_shared/retry.py` and `exceptions.py` now.

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_gemini.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.llm.gemini import GeminiProvider
from chatcut_backend.orchestrator.types import Message
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


@pytest.mark.asyncio
async def test_gemini_text_answer():
    p = GeminiProvider(api_key="key")

    fake_part = MagicMock(); fake_part.text = "hi"; fake_part.function_call = None
    fake_resp = MagicMock()
    fake_resp.candidates = [MagicMock()]
    fake_resp.candidates[0].content.parts = [fake_part]
    fake_resp.usage_metadata.prompt_token_count = 10
    fake_resp.usage_metadata.candidates_token_count = 2

    p._model = MagicMock()
    p._model.generate_content_async = AsyncMock(return_value=fake_resp)
    step = await p.run_turn(
        messages=[Message(role="user", content="hi")],
        tools=[],
        system_prompt="sys",
        cache=False,
    )
    assert step.type == "answer"
    assert step.answer == "hi"


@pytest.mark.asyncio
async def test_gemini_function_call():
    p = GeminiProvider(api_key="key")

    fake_call = MagicMock(); fake_call.name = "zoom_in"; fake_call.args = {"endScale": 200}
    fake_part = MagicMock(); fake_part.text = None; fake_part.function_call = fake_call
    fake_resp = MagicMock()
    fake_resp.candidates = [MagicMock()]
    fake_resp.candidates[0].content.parts = [fake_part]
    fake_resp.usage_metadata.prompt_token_count = 10
    fake_resp.usage_metadata.candidates_token_count = 2

    p._model = MagicMock()
    p._model.generate_content_async = AsyncMock(return_value=fake_resp)
    tools = [CanonicalTool(name="zoom_in", description="z", category="mutation",
                           params=[ToolParam(name="endScale", type="number", description="z", required=True)])]
    step = await p.run_turn(
        messages=[Message(role="user", content="zoom in 200%")],
        tools=tools,
        system_prompt="sys",
        cache=False,
    )
    assert step.type == "tool_calls"
    assert step.tool_calls[0].name == "zoom_in"
    assert step.tool_calls[0].arguments == {"endScale": 200}
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/gemini.py`:

```python
"""Gemini provider, rewritten thin against AsyncLLMProvider."""
from __future__ import annotations

from typing import Any

from chatcut_backend.exceptions import ProviderError, RateLimitError, TransientError
from chatcut_backend.llm._shared.tool_adapters import canonical_to_gemini
from chatcut_backend.orchestrator.types import (
    Message,
    Step,
    ToolCall,
    ToolResult,
    UsageInfo,
)
from chatcut_backend.registry.canonical import CanonicalTool


class GeminiProvider:
    name = "gemini"

    def __init__(self, *, api_key: str | None, model: str = "gemini-2.0-flash") -> None:
        self.api_key = api_key
        self.model_name = model
        self._model: Any = None

    async def is_configured(self) -> bool:
        return bool(self.api_key)

    def _ensure_model(self, system_prompt: str | None, tools: list[dict] | None) -> Any:
        if self._model is None:
            import google.generativeai as genai

            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(
                model_name=self.model_name,
                system_instruction=system_prompt or None,
                tools=tools or None,
            )
        return self._model

    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,  # ignored for Gemini
    ) -> Step:
        gemini_tools = canonical_to_gemini(tools) if tools else None
        model = self._ensure_model(system_prompt, gemini_tools)

        contents = self._to_gemini_contents(messages, tool_results)
        try:
            resp = await model.generate_content_async(contents)
        except Exception as e:
            raise self._translate(e) from e
        return self._to_step(resp)

    @staticmethod
    def _to_gemini_contents(messages: list[Message], tool_results: list[ToolResult] | None) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            text = m.content if isinstance(m.content, str) else " ".join(
                b.text or "" for b in m.content if b.type == "text"
            )
            role = "model" if m.role == "assistant" else "user"
            out.append({"role": role, "parts": [{"text": text}]})
        if tool_results:
            out.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "function_response": {
                                "name": tr.tool_call_id,
                                "response": tr.output if isinstance(tr.output, dict) else {"value": tr.output},
                            }
                        }
                        for tr in tool_results
                    ],
                }
            )
        return out

    def _to_step(self, response: Any) -> Step:
        usage = UsageInfo(
            input_tokens=getattr(response.usage_metadata, "prompt_token_count", 0),
            output_tokens=getattr(response.usage_metadata, "candidates_token_count", 0),
            model=self.model_name,
        )
        tool_calls: list[ToolCall] = []
        text_parts: list[str] = []
        for cand in response.candidates:
            for part in cand.content.parts:
                if part.text:
                    text_parts.append(part.text)
                if part.function_call:
                    tool_calls.append(
                        ToolCall(
                            id=part.function_call.name,
                            name=part.function_call.name,
                            arguments=dict(part.function_call.args),
                        )
                    )
        if tool_calls:
            return Step(type="tool_calls", tool_calls=tool_calls, usage=usage)
        return Step(type="answer", answer="".join(text_parts).strip(), usage=usage)

    def _translate(self, e: Exception) -> Exception:
        msg = str(e)
        # Use the SDK's typed exceptions when available; fall back to status-code probing.
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status == 429 or "rate limit" in msg.lower():
            return RateLimitError(msg, provider=self.name)
        if status is not None and 500 <= status < 600:
            return TransientError(msg, provider=self.name)
        return ProviderError(msg, provider=self.name)
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/providers/test_gemini.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/gemini.py backend/tests/providers/test_gemini.py
git commit -m "feat(backend): Gemini provider thin rewrite"
```

---

### Task 26: Groq provider rewrite

**Files:**
- Create: `backend/chatcut_backend/llm/groq.py`
- Test: `backend/tests/providers/test_groq.py`

- [ ] **Step 1: Failing test**

`backend/tests/providers/test_groq.py`:

```python
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.llm.groq import GroqProvider
from chatcut_backend.orchestrator.types import Message
from chatcut_backend.registry.canonical import CanonicalTool, ToolParam


@pytest.mark.asyncio
async def test_groq_text_answer():
    p = GroqProvider(api_key="key")
    msg = MagicMock(); msg.content = "hi"; msg.tool_calls = None
    choice = MagicMock(); choice.message = msg
    resp = MagicMock(); resp.choices = [choice]
    resp.usage.prompt_tokens = 10; resp.usage.completion_tokens = 2
    p._client = MagicMock()
    p._client.chat.completions.create = AsyncMock(return_value=resp)

    step = await p.run_turn(
        messages=[Message(role="user", content="hi")],
        tools=[],
        system_prompt="sys",
        cache=False,
    )
    assert step.type == "answer"
    assert step.answer == "hi"


@pytest.mark.asyncio
async def test_groq_tool_call():
    p = GroqProvider(api_key="key")
    fn = MagicMock(); fn.name = "zoom_in"; fn.arguments = json.dumps({"endScale": 200})
    tc = MagicMock(); tc.id = "call_1"; tc.function = fn
    msg = MagicMock(); msg.content = None; msg.tool_calls = [tc]
    choice = MagicMock(); choice.message = msg
    resp = MagicMock(); resp.choices = [choice]
    resp.usage.prompt_tokens = 10; resp.usage.completion_tokens = 2
    p._client = MagicMock()
    p._client.chat.completions.create = AsyncMock(return_value=resp)

    tools = [CanonicalTool(name="zoom_in", description="z", category="mutation",
                           params=[ToolParam(name="endScale", type="number", description="z", required=True)])]
    step = await p.run_turn(
        messages=[Message(role="user", content="zoom in 200%")],
        tools=tools,
        system_prompt="sys",
        cache=False,
    )
    assert step.type == "tool_calls"
    assert step.tool_calls[0].name == "zoom_in"
    assert step.tool_calls[0].arguments == {"endScale": 200}
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement**

`backend/chatcut_backend/llm/groq.py`:

```python
"""Groq provider, rewritten thin against AsyncLLMProvider."""
from __future__ import annotations

import json as _json
from typing import Any

from chatcut_backend.exceptions import ProviderError, RateLimitError, TransientError
from chatcut_backend.llm._shared.tool_adapters import canonical_to_groq
from chatcut_backend.orchestrator.types import (
    Message,
    Step,
    ToolCall,
    ToolResult,
    UsageInfo,
)
from chatcut_backend.registry.canonical import CanonicalTool


class GroqProvider:
    name = "groq"

    def __init__(self, *, api_key: str | None, model: str = "llama-3.3-70b-versatile") -> None:
        self.api_key = api_key
        self.model = model
        self._client: Any = None

    async def is_configured(self) -> bool:
        return bool(self.api_key)

    def _ensure_client(self) -> Any:
        if self._client is None:
            from groq import AsyncGroq

            self._client = AsyncGroq(api_key=self.api_key)
        return self._client

    async def run_turn(
        self,
        messages: list[Message],
        tools: list[CanonicalTool],
        tool_results: list[ToolResult] | None = None,
        system_prompt: str | None = None,
        cache: bool = True,  # ignored for Groq
    ) -> Step:
        client = self._ensure_client()
        groq_tools = canonical_to_groq(tools) if tools else None
        groq_messages = self._to_groq_messages(messages, tool_results, system_prompt)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": groq_messages,
        }
        if groq_tools:
            kwargs["tools"] = groq_tools
            kwargs["tool_choice"] = "auto"

        try:
            resp = await client.chat.completions.create(**kwargs)
        except Exception as e:
            raise self._translate(e) from e
        return self._to_step(resp)

    @staticmethod
    def _to_groq_messages(
        messages: list[Message],
        tool_results: list[ToolResult] | None,
        system_prompt: str | None,
    ) -> list[dict]:
        out: list[dict] = []
        if system_prompt:
            out.append({"role": "system", "content": system_prompt})
        for m in messages:
            content = m.content if isinstance(m.content, str) else " ".join(
                b.text or "" for b in m.content if b.type == "text"
            )
            out.append({"role": m.role, "content": content})
        if tool_results:
            for tr in tool_results:
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": tr.tool_call_id,
                        "content": _json.dumps(tr.output) if not isinstance(tr.output, str) else tr.output,
                    }
                )
        return out

    def _to_step(self, response: Any) -> Step:
        choice = response.choices[0].message
        usage = UsageInfo(
            input_tokens=getattr(response.usage, "prompt_tokens", 0),
            output_tokens=getattr(response.usage, "completion_tokens", 0),
            model=self.model,
        )
        if choice.tool_calls:
            calls = [
                ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=_json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else tc.function.arguments,
                )
                for tc in choice.tool_calls
            ]
            return Step(type="tool_calls", tool_calls=calls, usage=usage)
        return Step(type="answer", answer=(choice.content or "").strip(), usage=usage)

    def _translate(self, e: Exception) -> Exception:
        status = getattr(getattr(e, "response", None), "status_code", None)
        msg = str(e)
        if status == 429 or "rate limit" in msg.lower():
            return RateLimitError(msg, provider=self.name)
        if status is not None and 500 <= status < 600:
            return TransientError(msg, provider=self.name)
        return ProviderError(msg, provider=self.name)
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/llm/groq.py backend/tests/providers/test_groq.py
git commit -m "feat(backend): Groq provider thin rewrite"
```

---

### Task 27: Cross-provider contract tests

**Files:**
- Create: `backend/tests/providers/test_provider_contract.py`

- [ ] **Step 1: Write the contract suite**

`backend/tests/providers/test_provider_contract.py`:

```python
"""Every provider must satisfy the same contract: take canonical tools, return Step."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from chatcut_backend.llm.base import AsyncLLMProvider
from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.llm.gemini import GeminiProvider
from chatcut_backend.llm.groq import GroqProvider
from chatcut_backend.orchestrator.types import Message


@pytest.mark.parametrize("cls", [ClaudeProvider, GeminiProvider, GroqProvider])
def test_implements_protocol(cls):
    p = cls(api_key="x")
    assert isinstance(p, AsyncLLMProvider)


@pytest.mark.parametrize(
    "factory",
    [
        lambda: ClaudeProvider(api_key=None),
        lambda: GeminiProvider(api_key=None),
        lambda: GroqProvider(api_key=None),
    ],
)
@pytest.mark.asyncio
async def test_unconfigured_when_no_key(factory):
    p = factory()
    assert await p.is_configured() is False
```

- [ ] **Step 2: Run, expect pass**

```bash
cd backend && uv run pytest tests/providers/test_provider_contract.py -v
```

If the runtime-protocol check fails for Gemini/Groq, recheck their `name` attribute and `run_turn` signatures match `AsyncLLMProvider` exactly.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/providers/test_provider_contract.py
git commit -m "test(backend): cross-provider contract suite"
```

---

## Phase 3 — HTTP transport + clients

### Task 28: FastAPI app skeleton

**Files:**
- Create: `backend/chatcut_backend/transports/__init__.py`
- Create: `backend/chatcut_backend/transports/http.py`
- Test: `backend/tests/integration/__init__.py`
- Test: `backend/tests/integration/test_http_health.py`

- [ ] **Step 1: Failing test**

`backend/tests/integration/__init__.py`:

```python
```

`backend/tests/integration/test_http_health.py`:

```python
from fastapi.testclient import TestClient

from chatcut_backend.transports.http import app


def test_health_returns_ok():
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "providers" in body
    assert "registry_hash" in body
```

- [ ] **Step 2: Run, fail**

```bash
cd backend && uv run pytest tests/integration/test_http_health.py -v
```

- [ ] **Step 3: Implement skeleton**

`backend/chatcut_backend/transports/__init__.py`:

```python
"""HTTP and stdio MCP transports."""
```

`backend/chatcut_backend/transports/http.py`:

```python
"""FastAPI app: /api/turn + legacy shims + health/debug."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from chatcut_backend.llm.base import list_providers, register_provider
from chatcut_backend.llm.claude import ClaudeProvider
from chatcut_backend.llm.gemini import GeminiProvider
from chatcut_backend.llm.groq import GroqProvider
from chatcut_backend.logging import configure_logging, get_logger
from chatcut_backend.registry.canonical import CANONICAL_TOOLS, registry_hash
from chatcut_backend.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(level=settings.log_level)
    register_provider("claude", ClaudeProvider(api_key=settings.claude_api_key, model=settings.claude_model))
    register_provider("gemini", GeminiProvider(api_key=settings.gemini_api_key, model=settings.gemini_model))
    register_provider("groq", GroqProvider(api_key=settings.groq_api_key, model=settings.groq_model))
    get_logger("startup").info("ready", providers=list_providers())
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # narrowed in follow-up; transition value
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "providers": list_providers(),
        "registry_hash": registry_hash(CANONICAL_TOOLS),
    }
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/transports backend/tests/integration
git commit -m "feat(backend): FastAPI app skeleton + /health"
```

---

### Task 29: `POST /api/turn` endpoint

**Files:**
- Create: `backend/chatcut_backend/orchestrator/turn.py`
- Create: `backend/chatcut_backend/api/__init__.py`
- Create: `backend/chatcut_backend/api/turn.py`
- Modify: `backend/chatcut_backend/transports/http.py`
- Test: `backend/tests/integration/test_turn_endpoint.py`

- [ ] **Step 1: Failing test**

`backend/tests/integration/test_turn_endpoint.py`:

```python
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from chatcut_backend.llm.base import register_provider
from chatcut_backend.orchestrator.types import Step, ToolCall, UsageInfo
from chatcut_backend.transports.http import app


class _StubProvider:
    name = "claude"

    async def is_configured(self):
        return True

    async def run_turn(self, messages, tools, tool_results=None, system_prompt=None, cache=True):
        if not messages:
            return Step(type="answer", answer="hi", usage=UsageInfo())
        if "zoom" in (messages[-1].content if isinstance(messages[-1].content, str) else ""):
            return Step(
                type="tool_calls",
                tool_calls=[ToolCall(id="t1", name="zoom_in", arguments={"endScale": 200})],
                usage=UsageInfo(),
            )
        return Step(type="answer", answer="ok", usage=UsageInfo())


def test_turn_returns_text_answer():
    register_provider("claude", _StubProvider())
    client = TestClient(app)
    r = client.post(
        "/api/turn",
        json={
            "messages": [{"role": "user", "content": "hello"}],
            "client_type": "premiere",
            "provider_hint": "claude",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "answer"
    assert body["answer"] == "ok"


def test_turn_returns_tool_call():
    register_provider("claude", _StubProvider())
    client = TestClient(app)
    r = client.post(
        "/api/turn",
        json={
            "messages": [{"role": "user", "content": "zoom in 200%"}],
            "client_type": "premiere",
            "provider_hint": "claude",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "tool_calls"
    assert body["tool_calls"][0]["name"] == "zoom_in"


def test_turn_unknown_client_type_400():
    client = TestClient(app)
    r = client.post(
        "/api/turn",
        json={
            "messages": [{"role": "user", "content": "x"}],
            "client_type": "fcp",  # not yet supported
            "provider_hint": "claude",
        },
    )
    assert r.status_code in (400, 422)
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement orchestrator + endpoint**

`backend/chatcut_backend/orchestrator/turn.py`:

```python
"""Provider-agnostic per-turn driver."""
from __future__ import annotations

from chatcut_backend.exceptions import ValidationError
from chatcut_backend.llm.base import get_provider, list_providers
from chatcut_backend.orchestrator.types import Step, TurnRequest
from chatcut_backend.registry.canonical import CANONICAL_TOOLS
from chatcut_backend.registry.filters import filter_for_profile
from chatcut_backend.registry.profiles.chatcut import CHATCUT_PROFILE
from chatcut_backend.registry.profiles.premiere import PREMIERE_PROFILE
from chatcut_backend.settings import get_settings

PROFILES = {
    "premiere": PREMIERE_PROFILE,
    "chatcut": CHATCUT_PROFILE,
}


async def run_turn(req: TurnRequest, *, system_prompt: str | None = None) -> Step:
    profile = PROFILES.get(req.client_type)
    if profile is None:
        raise ValidationError(f"unsupported client_type: {req.client_type}")
    tools = filter_for_profile(CANONICAL_TOOLS, profile)

    settings = get_settings()
    provider_name = req.provider_hint or settings.ai_provider
    if provider_name not in list_providers():
        raise ValidationError(f"provider not registered: {provider_name}")
    provider = get_provider(provider_name)

    return await provider.run_turn(
        messages=req.messages,
        tools=tools,
        tool_results=req.tool_results,
        system_prompt=system_prompt,
        cache=req.cache,
    )
```

`backend/chatcut_backend/api/__init__.py`:

```python
"""HTTP route modules."""
```

`backend/chatcut_backend/api/turn.py`:

```python
"""POST /api/turn — the canonical multi-turn entry point."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from chatcut_backend.exceptions import ValidationError
from chatcut_backend.orchestrator.turn import run_turn
from chatcut_backend.orchestrator.types import Step, TurnRequest

router = APIRouter()

DEFAULT_SYSTEM_PROMPT = (
    "You are a video-editing assistant. Use the provided tools to perform edits "
    "or to inspect the current sequence. Prefer ask_clarification over guessing."
)


@router.post("/api/turn", response_model=Step)
async def post_turn(req: TurnRequest) -> Step:
    try:
        return await run_turn(req, system_prompt=DEFAULT_SYSTEM_PROMPT)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
```

Append to `backend/chatcut_backend/transports/http.py` (after `app = FastAPI(...)`):

```python
from chatcut_backend.api.turn import router as turn_router

app.include_router(turn_router)
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/integration/test_turn_endpoint.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/orchestrator/turn.py backend/chatcut_backend/api \
        backend/chatcut_backend/transports/http.py backend/tests/integration/test_turn_endpoint.py
git commit -m "feat(backend): POST /api/turn endpoint"
```

---

### Task 30: Legacy shim — `/api/process-prompt`

**Files:**
- Create: `backend/chatcut_backend/api/legacy.py`
- Modify: `backend/chatcut_backend/transports/http.py`
- Test: `backend/tests/integration/test_legacy_process_prompt.py`

The shim builds a synthetic `TurnRequest` from the legacy payload, calls `run_turn`, and converts the resulting `Step` back to the legacy `ProcessPromptResponse` shape (see `backend/models/schemas.py:9-28`).

- [ ] **Step 1: Failing test**

`backend/tests/integration/test_legacy_process_prompt.py`:

```python
from fastapi.testclient import TestClient

from chatcut_backend.llm.base import register_provider
from chatcut_backend.orchestrator.types import Step, ToolCall, UsageInfo
from chatcut_backend.transports.http import app


class _Stub:
    name = "claude"
    async def is_configured(self):
        return True
    async def run_turn(self, messages, tools, tool_results=None, system_prompt=None, cache=True):
        return Step(
            type="tool_calls",
            tool_calls=[ToolCall(id="t1", name="zoom_in", arguments={"endScale": 200})],
            usage=UsageInfo(),
        )


def test_legacy_process_prompt_returns_action_shape():
    register_provider("claude", _Stub())
    client = TestClient(app)
    r = client.post(
        "/api/process-prompt",
        json={"prompt": "zoom in 200%", "client_type": "premiere"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "zoom_in"
    assert body["parameters"] == {"endScale": 200}
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement legacy shim**

`backend/chatcut_backend/api/legacy.py`:

```python
"""Legacy endpoints — internally routed through the new orchestrator."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from chatcut_backend.orchestrator.turn import run_turn
from chatcut_backend.orchestrator.types import Message, TurnRequest

router = APIRouter()


class _ProcessPromptRequest(BaseModel):
    prompt: str
    context_params: dict[str, Any] | None = None
    client_type: str | None = "premiere"


class _ProcessPromptResponse(BaseModel):
    action: str | None = None
    parameters: dict[str, Any] = {}
    actions: list[dict[str, Any]] | None = None
    confidence: float = 0.0
    message: str = ""
    response: str | None = None
    error: str | None = None
    raw_response: str | None = None


@router.post("/api/process-prompt", response_model=_ProcessPromptResponse)
async def process_prompt(req: _ProcessPromptRequest) -> _ProcessPromptResponse:
    turn = TurnRequest(
        messages=[Message(role="user", content=req.prompt)],
        tool_results=None,
        client_type=req.client_type or "premiere",  # type: ignore[arg-type]
    )
    step = await run_turn(turn)
    if step.type == "answer":
        return _ProcessPromptResponse(message=step.answer or "", response=step.answer)
    calls = step.tool_calls or []
    if len(calls) == 1:
        c = calls[0]
        return _ProcessPromptResponse(action=c.name, parameters=c.arguments, confidence=1.0)
    return _ProcessPromptResponse(
        actions=[{"action": c.name, "parameters": c.arguments} for c in calls],
        confidence=1.0,
    )
```

Add to `backend/chatcut_backend/transports/http.py` (after the turn_router include):

```python
from chatcut_backend.api.legacy import router as legacy_router

app.include_router(legacy_router)
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/api/legacy.py backend/chatcut_backend/transports/http.py \
        backend/tests/integration/test_legacy_process_prompt.py
git commit -m "feat(backend): legacy /api/process-prompt shim through new orchestrator"
```

---

### Task 31: Legacy shim — `/api/ask-question`

**Files:**
- Modify: `backend/chatcut_backend/api/legacy.py`
- Test: `backend/tests/integration/test_legacy_ask_question.py`

- [ ] **Step 1: Failing test**

`backend/tests/integration/test_legacy_ask_question.py`:

```python
from fastapi.testclient import TestClient

from chatcut_backend.llm.base import register_provider
from chatcut_backend.orchestrator.types import Step, UsageInfo
from chatcut_backend.transports.http import app


class _AnswerStub:
    name = "claude"
    async def is_configured(self):
        return True
    async def run_turn(self, messages, tools, tool_results=None, system_prompt=None, cache=True):
        return Step(type="answer", answer="A clip is a piece of media on the timeline.", usage=UsageInfo())


def test_legacy_ask_question_returns_message():
    register_provider("claude", _AnswerStub())
    client = TestClient(app)
    r = client.post(
        "/api/ask-question",
        json={"messages": [{"role": "user", "content": "what is a clip?"}]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message"].startswith("A clip")
    assert body["error"] is None
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Append to `legacy.py`**

```python
class _AskQuestionRequest(BaseModel):
    messages: list[dict[str, Any]]


class _AskQuestionResponse(BaseModel):
    message: str
    error: str | None = None


_QA_SYSTEM_PROMPT = (
    "You are a Premiere Pro reference assistant. Answer concisely. "
    "Do not invent menu paths; say 'I don't know' when unsure."
)


@router.post("/api/ask-question", response_model=_AskQuestionResponse)
async def ask_question(req: _AskQuestionRequest) -> _AskQuestionResponse:
    msgs = [Message(role=str(m.get("role", "user")), content=str(m.get("content", ""))) for m in req.messages]
    turn = TurnRequest(messages=msgs, tool_results=None, client_type="premiere")
    # Force no tools for Q&A by routing through a separate orchestrator entry, or just
    # rely on the system prompt to tell the model not to use tools. We do the latter:
    step = await run_turn(turn, system_prompt=_QA_SYSTEM_PROMPT)  # type: ignore[call-arg]
    if step.type == "answer":
        return _AskQuestionResponse(message=step.answer or "")
    return _AskQuestionResponse(
        message="(model attempted a tool call; QA mode does not run tools)",
        error="unexpected_tool_call",
    )
```

Update `run_turn` in `orchestrator/turn.py` to accept the optional `system_prompt` kwarg (it already does in Task 29's code). Verify the signature matches.

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/api/legacy.py backend/tests/integration/test_legacy_ask_question.py
git commit -m "feat(backend): legacy /api/ask-question shim"
```

---

### Task 32: Integrations API — port `/api/process-media`, `/api/colab-*`, `/api/process-object-tracking`

**Files:**
- Create: `backend/chatcut_backend/integrations/__init__.py`
- Create: `backend/chatcut_backend/integrations/runway.py` (copy from `backend/services/providers/video_provider.py`)
- Create: `backend/chatcut_backend/integrations/colab.py` (copy from `backend/services/colab_proxy.py`)
- Create: `backend/chatcut_backend/integrations/object_tracking.py` (extract from `backend/services/ai_service.py`)
- Create: `backend/chatcut_backend/api/integrations.py`
- Modify: `backend/chatcut_backend/transports/http.py`
- Test: `backend/tests/integration/test_integrations_routing.py`

This is a folder-rename + import-fixup task per the Q5 decision (B). No behavior change.

- [ ] **Step 1: Copy and rename**

```bash
cd backend
mkdir -p chatcut_backend/integrations
cp services/providers/video_provider.py chatcut_backend/integrations/runway.py
cp services/colab_proxy.py chatcut_backend/integrations/colab.py
touch chatcut_backend/integrations/__init__.py
touch chatcut_backend/integrations/object_tracking.py
```

For `object_tracking.py`, copy any object-tracking helper code from `backend/services/ai_service.py` (the legacy path that handles the `/api/process-object-tracking` route). If the logic is purely route-level, leave the module empty for now and put it directly in `api/integrations.py`.

- [ ] **Step 2: Failing routing smoke test**

`backend/tests/integration/test_integrations_routing.py`:

```python
from fastapi.testclient import TestClient

from chatcut_backend.transports.http import app


def test_routes_registered():
    client = TestClient(app)
    routes = {r.path for r in app.routes}
    for path in ["/api/process-media", "/api/colab-start", "/api/colab-progress",
                 "/api/colab-health", "/api/process-object-tracking"]:
        assert path in routes, f"missing {path}"
```

- [ ] **Step 3: Run, fail**

- [ ] **Step 4: Port the existing route handlers**

Open `backend/main.py` and locate each handler (`@app.post("/api/process-media")`, etc.). Copy the body verbatim into `backend/chatcut_backend/api/integrations.py`, replacing imports of `services.*` with imports from `chatcut_backend.integrations.*`. Wrap in `APIRouter`:

```python
"""Legacy integration endpoints (Runway video, Colab GPU proxy, object tracking)."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from chatcut_backend.integrations import colab, runway

router = APIRouter()


class _ProcessMediaRequest(BaseModel):
    filePath: str
    prompt: str


@router.post("/api/process-media")
async def process_media(req: _ProcessMediaRequest):
    return await runway.process_file(req.filePath, req.prompt)


# Reproduce the colab and object-tracking handlers similarly. Their bodies live in
# backend/main.py — copy them verbatim and update imports.
```

The exact bodies of the colab handlers and object-tracking handler should be transferred verbatim from `backend/main.py`; this plan does not duplicate them because they exceed 100 lines and the source-of-truth is the existing file.

Then in `transports/http.py`:

```python
from chatcut_backend.api.integrations import router as integrations_router

app.include_router(integrations_router)
```

- [ ] **Step 5: Run, pass**

```bash
cd backend && uv run pytest tests/integration/test_integrations_routing.py -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/chatcut_backend/integrations backend/chatcut_backend/api/integrations.py \
        backend/chatcut_backend/transports/http.py \
        backend/tests/integration/test_integrations_routing.py
git commit -m "feat(backend): port integrations endpoints (folder hygiene rename)"
```

---

### Task 33: `GET /api/debug/tools`

**Files:**
- Modify: `backend/chatcut_backend/transports/http.py`
- Test: `backend/tests/integration/test_debug_tools.py`

- [ ] **Step 1: Failing test**

`backend/tests/integration/test_debug_tools.py`:

```python
from fastapi.testclient import TestClient

from chatcut_backend.transports.http import app


def test_debug_tools_premiere_claude(monkeypatch):
    monkeypatch.setenv("DEBUG_ENDPOINTS_ENABLED", "true")
    # Need to bypass the cached settings singleton:
    from chatcut_backend import settings
    settings._singleton = None

    client = TestClient(app)
    r = client.get("/api/debug/tools?profile=premiere&provider=claude")
    assert r.status_code == 200
    body = r.json()
    assert body["profile"] == "premiere"
    assert body["provider"] == "claude"
    assert len(body["tools"]) == 14


def test_debug_tools_disabled_when_flag_off(monkeypatch):
    monkeypatch.setenv("DEBUG_ENDPOINTS_ENABLED", "false")
    from chatcut_backend import settings
    settings._singleton = None

    client = TestClient(app)
    r = client.get("/api/debug/tools?profile=premiere&provider=claude")
    assert r.status_code == 404
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Add the debug route**

Append to `backend/chatcut_backend/transports/http.py`:

```python
from fastapi import HTTPException, Query

from chatcut_backend.llm._shared.tool_adapters import (
    canonical_to_claude,
    canonical_to_gemini,
    canonical_to_groq,
)
from chatcut_backend.orchestrator.turn import PROFILES
from chatcut_backend.registry.filters import filter_for_profile

_ADAPTERS = {
    "claude": canonical_to_claude,
    "gemini": canonical_to_gemini,
    "groq": canonical_to_groq,
}


@app.get("/api/debug/tools")
async def debug_tools(
    profile: str = Query(...),
    provider: str = Query(...),
) -> dict:
    if not get_settings().debug_endpoints_enabled:
        raise HTTPException(status_code=404)
    if profile not in PROFILES:
        raise HTTPException(status_code=400, detail=f"unknown profile: {profile}")
    if provider not in _ADAPTERS:
        raise HTTPException(status_code=400, detail=f"unknown provider: {provider}")
    tools = filter_for_profile(CANONICAL_TOOLS, PROFILES[profile])
    return {"profile": profile, "provider": provider, "tools": _ADAPTERS[provider](tools)}
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/transports/http.py backend/tests/integration/test_debug_tools.py
git commit -m "feat(backend): GET /api/debug/tools (gated by env flag)"
```

---

### Task 34: Run legacy `backend/tests/` against the new code paths

**Files:**
- Modify: `backend/tests/conftest.py` (point legacy tests at the new app if needed)

- [ ] **Step 1: Run the existing test suite**

```bash
cd backend && uv run pytest tests/ -v -x
```

If failures arise, they are real signals: the new orchestrator changed the behavior of a legacy endpoint. Fix the orchestrator/legacy shim until the legacy tests pass.

- [ ] **Step 2: Address each failure (if any) one commit at a time**

For each failure: identify the root cause (usually a mismatch between the legacy response shape and the orchestrator's `Step` translation), update `chatcut_backend/api/legacy.py`, re-run, commit.

- [ ] **Step 3: Final run, all green**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all green; total test count ≥ ~50 (15 unit + provider tests + integration + legacy).

- [ ] **Step 4: Commit any final fixes**

```bash
git add -p
git commit -m "fix(backend): align legacy shims with existing test fixtures"
```

---

### Task 35: UXP plugin — multi-turn loop runner

**Files:**
- Modify: `premiere-plugin/src/api.js` (or wherever the existing fetch lives — discover via `grep -r 'process-prompt' premiere-plugin/`)
- Create: `premiere-plugin/src/turn-runner.js`
- Test: `premiere-plugin/test/turn-runner.test.js` (uses jest if present, otherwise vitest)

- [ ] **Step 1: Discover the current call site**

```bash
grep -rn 'process-prompt\|ask-question' premiere-plugin/src/
```

The result tells you which existing module sends to the backend. Note its filename for Step 4.

- [ ] **Step 2: Failing test**

`premiere-plugin/test/turn-runner.test.js`:

```javascript
import { runTurnLoop } from "../src/turn-runner.js";

test("returns answer on first turn", async () => {
  const fetchStub = async () =>
    new Response(JSON.stringify({ type: "answer", answer: "ok" }), { status: 200 });
  const dispatchStub = async () => { throw new Error("should not be called"); };

  const out = await runTurnLoop({
    messages: [{ role: "user", content: "hi" }],
    fetch: fetchStub,
    dispatch: dispatchStub,
    clientType: "premiere",
  });
  expect(out.answer).toBe("ok");
});

test("loops through one tool call then answer", async () => {
  let call = 0;
  const fetchStub = async (url, init) => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ id: "t1", name: "zoom_in", arguments: { endScale: 200 } }],
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ type: "answer", answer: "done" }), { status: 200 });
  };
  const dispatchStub = async (call) => ({ tool_call_id: call.id, output: { ok: true } });
  const out = await runTurnLoop({
    messages: [{ role: "user", content: "zoom" }],
    fetch: fetchStub,
    dispatch: dispatchStub,
    clientType: "premiere",
  });
  expect(out.answer).toBe("done");
  expect(call).toBe(2);
});

test("hard cap stops at max iterations", async () => {
  const fetchStub = async () =>
    new Response(
      JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ id: "t1", name: "zoom_in", arguments: {} }],
      }),
      { status: 200 }
    );
  const dispatchStub = async (c) => ({ tool_call_id: c.id, output: {} });
  await expect(
    runTurnLoop({
      messages: [{ role: "user", content: "x" }],
      fetch: fetchStub,
      dispatch: dispatchStub,
      clientType: "premiere",
      maxIterations: 2,
    })
  ).rejects.toThrow(/max iterations/);
});
```

- [ ] **Step 3: Run, fail**

```bash
cd premiere-plugin && npx jest test/turn-runner.test.js
```

If jest isn't configured, follow the existing test runner's conventions (find via `cat premiere-plugin/package.json | jq .scripts`).

- [ ] **Step 4: Implement the loop runner**

`premiere-plugin/src/turn-runner.js`:

```javascript
/**
 * Multi-turn /api/turn loop runner.
 * Calls the backend, executes any returned tool calls locally via `dispatch`,
 * loops until the server returns a terminal answer, or maxIterations is reached.
 */
const DEFAULT_BACKEND = "http://localhost:8000";

export async function runTurnLoop({
  messages,
  fetch,
  dispatch,
  clientType,
  providerHint,
  maxIterations = 8,
  backendUrl = DEFAULT_BACKEND,
}) {
  let toolResults = null;
  for (let i = 0; i < maxIterations; i++) {
    const resp = await fetch(`${backendUrl}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        tool_results: toolResults,
        client_type: clientType,
        provider_hint: providerHint,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`/api/turn ${resp.status}: ${text}`);
    }
    const step = await resp.json();
    if (step.type === "answer") {
      return { answer: step.answer, usage: step.usage };
    }
    // Execute tool calls locally; collect results for the next turn.
    toolResults = [];
    for (const call of step.tool_calls || []) {
      try {
        const result = await dispatch(call);
        toolResults.push({ tool_call_id: call.id, output: result.output ?? result, is_error: false });
      } catch (err) {
        toolResults.push({
          tool_call_id: call.id,
          output: { error: String(err) },
          is_error: true,
        });
      }
    }
    // Append the tool calls + results to the message history for the next turn:
    messages = messages.concat([
      {
        role: "assistant",
        content: (step.tool_calls || []).map((c) => ({
          type: "tool_use",
          tool_use_id: c.id,
          tool_name: c.name,
          input: c.arguments,
        })),
      },
    ]);
  }
  throw new Error(`runTurnLoop: hit max iterations (${maxIterations}) without terminal answer`);
}
```

- [ ] **Step 5: Run, pass**

```bash
cd premiere-plugin && npx jest test/turn-runner.test.js
```

- [ ] **Step 6: Commit**

```bash
git add premiere-plugin/src/turn-runner.js premiere-plugin/test/turn-runner.test.js
git commit -m "feat(plugin): /api/turn multi-turn loop runner"
```

---

### Task 36: Tauri desktop — multi-turn loop runner

**Files:**
- Create: `web/src/lib/backend/turnRunner.ts`
- Test: `web/src/lib/backend/turnRunner.test.ts`

- [ ] **Step 1: Failing test**

`web/src/lib/backend/turnRunner.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import { runTurnLoop } from "./turnRunner";

describe("runTurnLoop", () => {
  it("returns answer when server answers immediately", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "answer", answer: "ok" }), { status: 200 }),
    );
    const dispatch = vi.fn();
    const out = await runTurnLoop({
      messages: [{ role: "user", content: "hi" }],
      clientType: "chatcut",
      fetch: fetchStub,
      dispatch,
    });
    expect(out.answer).toBe("ok");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches tool calls and resends results", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "tool_calls",
            tool_calls: [{ id: "t1", name: "zoom_in", arguments: { endScale: 200 } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "answer", answer: "done" }), { status: 200 }),
      );
    const dispatch = vi.fn().mockResolvedValue({ output: { ok: true } });

    const out = await runTurnLoop({
      messages: [{ role: "user", content: "zoom" }],
      clientType: "chatcut",
      fetch: fetchStub,
      dispatch,
    });
    expect(out.answer).toBe("done");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("throws on max iterations", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ id: "t1", name: "zoom_in", arguments: {} }],
        }),
        { status: 200 },
      ),
    );
    const dispatch = vi.fn().mockResolvedValue({ output: {} });
    await expect(
      runTurnLoop({
        messages: [{ role: "user", content: "x" }],
        clientType: "chatcut",
        fetch: fetchStub,
        dispatch,
        maxIterations: 2,
      }),
    ).rejects.toThrow(/max iterations/);
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
cd web && npx vitest run src/lib/backend/turnRunner.test.ts
```

- [ ] **Step 3: Implement**

`web/src/lib/backend/turnRunner.ts`:

```typescript
/**
 * Multi-turn /api/turn loop runner for the Tauri desktop client.
 */

export type Role = "user" | "assistant" | "tool_result";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  tool_use_id?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown> | string;
  is_error?: boolean;
}

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPayload {
  tool_call_id: string;
  output: Record<string, unknown> | string;
  is_error?: boolean;
}

export interface RunTurnLoopArgs {
  messages: Message[];
  clientType: "chatcut" | "premiere";
  providerHint?: "claude" | "gemini" | "groq";
  fetch?: typeof fetch;
  dispatch: (call: ToolCall) => Promise<{ output: Record<string, unknown> | string }>;
  maxIterations?: number;
  backendUrl?: string;
}

const DEFAULT_BACKEND = "http://localhost:8000";

export async function runTurnLoop(args: RunTurnLoopArgs): Promise<{
  answer: string;
  usage?: Record<string, unknown>;
}> {
  const f = args.fetch ?? fetch;
  let messages = args.messages.slice();
  let toolResults: ToolResultPayload[] | null = null;
  const max = args.maxIterations ?? 8;
  const url = (args.backendUrl ?? DEFAULT_BACKEND) + "/api/turn";

  for (let i = 0; i < max; i++) {
    const resp = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        tool_results: toolResults,
        client_type: args.clientType,
        provider_hint: args.providerHint,
      }),
    });
    if (!resp.ok) throw new Error(`/api/turn ${resp.status}: ${await resp.text()}`);
    const step = await resp.json();
    if (step.type === "answer") return { answer: step.answer, usage: step.usage };

    const calls: ToolCall[] = step.tool_calls ?? [];
    toolResults = [];
    for (const c of calls) {
      try {
        const r = await args.dispatch(c);
        toolResults.push({ tool_call_id: c.id, output: r.output, is_error: false });
      } catch (e) {
        toolResults.push({ tool_call_id: c.id, output: { error: String(e) }, is_error: true });
      }
    }
    messages = messages.concat([
      {
        role: "assistant",
        content: calls.map((c) => ({
          type: "tool_use",
          tool_use_id: c.id,
          tool_name: c.name,
          input: c.arguments,
        })),
      },
    ]);
  }
  throw new Error(`runTurnLoop: hit max iterations (${max}) without terminal answer`);
}
```

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/backend/turnRunner.ts web/src/lib/backend/turnRunner.test.ts
git commit -m "feat(web): /api/turn multi-turn loop runner"
```

---

### Task 37: Wire introspection tools — UXP

**Files:**
- Modify: `premiere-plugin/src/actionDispatcher.js` (locate via grep)

The 5 introspection tools need handlers in the existing UXP action dispatcher. Each calls a UXP API and returns canonical-shape data.

- [ ] **Step 1: Locate the dispatcher**

```bash
grep -rn 'actionDispatcher\|case .zoom_in\|case .applyFilter' premiere-plugin/src/
```

- [ ] **Step 2: Failing smoke test (manual or via the existing UXP test harness if present)**

If no test harness exists, this step is a manual verification: call `dispatch({id:"t1", name:"get_playhead_position", arguments:{}})` from the plugin's dev console and assert it returns `{seconds, frames, fps}`.

- [ ] **Step 3: Add the 5 handlers**

Append to the dispatcher (cases must match the canonical names from the registry — `get_selected_clips`, `get_clip_parameters`, `get_active_sequence_info`, `get_playhead_position`, `list_applied_effects`).

```javascript
async function handleGetSelectedClips() {
  // UXP: ppro.app.project.activeSequence.getSelection()
  const sel = ppro.app.project.activeSequence.getSelection();
  return sel.map((clip) => ({
    clip_id: clip.nodeId,
    name: clip.name,
    track_index: clip.trackIndex,
    in_point_seconds: clip.start.seconds,
    out_point_seconds: clip.end.seconds,
    source_path: clip.projectItem?.getMediaPath?.() ?? null,
  }));
}

async function handleGetActiveSequenceInfo() {
  const seq = ppro.app.project.activeSequence;
  return {
    width: seq.frameSize.width,
    height: seq.frameSize.height,
    fps: 1.0 / seq.timebase, // confirm against the actual UXP API
    duration_seconds: seq.end.seconds,
    video_track_count: seq.videoTracks.length,
    audio_track_count: seq.audioTracks.length,
    name: seq.name,
  };
}

async function handleGetPlayheadPosition() {
  const seq = ppro.app.project.activeSequence;
  const t = seq.getPlayerPosition();
  return { seconds: t.seconds, frames: Math.round(t.seconds * (1 / seq.timebase)), fps: 1 / seq.timebase };
}

async function handleGetClipParameters({ clipId }) {
  // Find the clip by nodeId, return its applied components + parameters.
  // The exact UXP API call depends on the plugin's existing helpers; reuse them.
  return getClipById(clipId).getComponents().map((c) => ({
    effect_id: c.matchName,
    display_name: c.displayName,
    parameters: Object.fromEntries(c.properties.map((p) => [p.displayName, p.getValue()])),
  }));
}

async function handleListAppliedEffects({ clipId }) {
  return getClipById(clipId).getComponents().map((c) => ({
    effect_id: c.matchName,
    display_name: c.displayName,
    category: c.category ?? "video",
  }));
}
```

Wire into the dispatcher's switch:

```javascript
switch (action) {
  // ... existing cases ...
  case "get_selected_clips":      return await handleGetSelectedClips();
  case "get_active_sequence_info": return await handleGetActiveSequenceInfo();
  case "get_playhead_position":   return await handleGetPlayheadPosition();
  case "get_clip_parameters":     return await handleGetClipParameters(args);
  case "list_applied_effects":    return await handleListAppliedEffects(args);
}
```

(`getClipById` is a helper that should already exist or be trivial to add; if not, search the dispatcher for how clips are looked up by id elsewhere.)

- [ ] **Step 4: Manual smoke**

Open the plugin in Premiere with a sequence loaded, type "what clips are selected?" — expect Claude to call `get_selected_clips` and return real data.

- [ ] **Step 5: Commit**

```bash
git add premiere-plugin/src/actionDispatcher.js
git commit -m "feat(plugin): UXP handlers for 5 introspection tools"
```

---

### Task 38: Wire introspection tools — Tauri

**Files:**
- Modify: `web/src/lib/backend/dispatchTool.ts` (create if missing)
- Test: `web/src/lib/backend/dispatchTool.test.ts`

For Tauri, introspection reads from the existing client-side state stores (timeline state, playhead, sequence settings). Each handler reads from the relevant Zustand/Redux store and returns canonical-shape data.

- [ ] **Step 1: Discover existing state stores**

```bash
grep -rn 'export.*Store\|create<.*Store\|useTimeline\|usePlayhead' web/src/
```

The result tells you which stores hold which data. You will read clip selection, playhead position, and active sequence info from these.

- [ ] **Step 2: Failing test**

`web/src/lib/backend/dispatchTool.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import { makeDispatcher } from "./dispatchTool";

describe("makeDispatcher introspection", () => {
  it("get_playhead_position returns {seconds, frames, fps}", async () => {
    const dispatcher = makeDispatcher({
      getPlayhead: () => ({ seconds: 12.5 }),
      getSequence: () => ({ fps: 30, width: 1920, height: 1080, durationSeconds: 60, name: "Seq" }),
      getSelectedClips: () => [],
      getClipById: () => null,
    });
    const result = await dispatcher({ id: "t1", name: "get_playhead_position", arguments: {} });
    expect(result.output).toEqual({ seconds: 12.5, frames: 375, fps: 30 });
  });

  it("get_active_sequence_info returns spec-shape data", async () => {
    const dispatcher = makeDispatcher({
      getPlayhead: () => ({ seconds: 0 }),
      getSequence: () => ({ fps: 30, width: 1920, height: 1080, durationSeconds: 60, name: "Seq" }),
      getSelectedClips: () => [],
      getClipById: () => null,
    });
    const r = await dispatcher({ id: "t2", name: "get_active_sequence_info", arguments: {} });
    expect(r.output).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      duration_seconds: 60,
      name: "Seq",
    });
  });
});
```

- [ ] **Step 3: Run, fail**

- [ ] **Step 4: Implement**

`web/src/lib/backend/dispatchTool.ts`:

```typescript
import type { ToolCall } from "./turnRunner";

export interface DispatcherDeps {
  getPlayhead: () => { seconds: number };
  getSequence: () => {
    fps: number;
    width: number;
    height: number;
    durationSeconds: number;
    name: string;
    videoTrackCount?: number;
    audioTrackCount?: number;
  };
  getSelectedClips: () => Array<{
    clipId: string;
    name: string;
    trackIndex: number;
    inSeconds: number;
    outSeconds: number;
    sourcePath: string | null;
  }>;
  getClipById: (id: string) => null | {
    effects: Array<{ id: string; displayName: string; category: string; parameters: Record<string, unknown> }>;
  };
  applyMutation?: (call: ToolCall) => Promise<{ output: Record<string, unknown> | string }>;
}

export function makeDispatcher(deps: DispatcherDeps) {
  return async function dispatch(call: ToolCall): Promise<{ output: Record<string, unknown> | string }> {
    switch (call.name) {
      case "get_playhead_position": {
        const { seconds } = deps.getPlayhead();
        const { fps } = deps.getSequence();
        return { output: { seconds, frames: Math.round(seconds * fps), fps } };
      }
      case "get_active_sequence_info": {
        const s = deps.getSequence();
        return {
          output: {
            width: s.width,
            height: s.height,
            fps: s.fps,
            duration_seconds: s.durationSeconds,
            video_track_count: s.videoTrackCount ?? 0,
            audio_track_count: s.audioTrackCount ?? 0,
            name: s.name,
          },
        };
      }
      case "get_selected_clips": {
        return {
          output: deps.getSelectedClips().map((c) => ({
            clip_id: c.clipId,
            name: c.name,
            track_index: c.trackIndex,
            in_point_seconds: c.inSeconds,
            out_point_seconds: c.outSeconds,
            source_path: c.sourcePath,
          })),
        };
      }
      case "get_clip_parameters": {
        const id = String((call.arguments as any).clipId ?? "");
        const clip = deps.getClipById(id);
        if (!clip) return { output: { error: `clip ${id} not found` } };
        return { output: clip.effects.map((e) => ({ effect_id: e.id, display_name: e.displayName, parameters: e.parameters })) };
      }
      case "list_applied_effects": {
        const id = String((call.arguments as any).clipId ?? "");
        const clip = deps.getClipById(id);
        if (!clip) return { output: { error: `clip ${id} not found` } };
        return { output: clip.effects.map((e) => ({ effect_id: e.id, display_name: e.displayName, category: e.category })) };
      }
      default: {
        if (!deps.applyMutation) {
          return { output: { error: `unhandled tool: ${call.name}` } };
        }
        return deps.applyMutation(call);
      }
    }
  };
}
```

- [ ] **Step 5: Run, pass**

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/backend/dispatchTool.ts web/src/lib/backend/dispatchTool.test.ts
git commit -m "feat(web): Tauri dispatcher for introspection tools"
```

---

## Phase 4 — stdio MCP + vendor + docs

### Task 39: Vendor premiere-pro MCP schemas

**Files:**
- Create: `backend/chatcut_backend/registry/profiles/_vendor/premiere-pro-mcp/LICENSE`
- Create: `backend/chatcut_backend/registry/profiles/_vendor/premiere-pro-mcp/tools.py`
- Create: `backend/chatcut_backend/registry/profiles/_vendor/README.md`

- [ ] **Step 1: Identify the upstream**

The MIT-licensed reference is the premiere-pro MCP project the user has discussed in earlier conversations. Confirm the upstream URL and SHA before vendoring (e.g., `https://github.com/<owner>/premiere-pro-mcp`). Cap the imported set at the 110 tools the user has previously cited.

- [ ] **Step 2: Copy the LICENSE file verbatim**

```bash
mkdir -p backend/chatcut_backend/registry/profiles/_vendor/premiere-pro-mcp
curl -sL "https://raw.githubusercontent.com/<owner>/premiere-pro-mcp/<sha>/LICENSE" \
  -o backend/chatcut_backend/registry/profiles/_vendor/premiere-pro-mcp/LICENSE
```

If you don't have network access, substitute by copying the LICENSE from a local clone of the repo.

- [ ] **Step 3: Extract the tool schemas (names + descriptions + JSON schemas) into `tools.py`**

The vendor module exports a single `VENDOR_TOOLS: list[CanonicalTool]` so that `premiere.py` can import and re-export.

The exact contents depend on the upstream. Do **not** vendor server execution code — only the schema declarations. If upstream uses TypeScript or another language, transcribe the schema declarations into `CanonicalTool` Pydantic objects manually.

- [ ] **Step 4: Vendor README**

`backend/chatcut_backend/registry/profiles/_vendor/README.md`:

```markdown
# Vendored MCP schemas

| Vendor | Upstream | Vendored at SHA | Files |
|---|---|---|---|
| premiere-pro-mcp | https://github.com/<owner>/premiere-pro-mcp | `<sha>` | LICENSE, tools.py |

## Refresh process

1. `cd backend/chatcut_backend/registry/profiles/_vendor/premiere-pro-mcp`
2. Replace LICENSE and tool definitions from the upstream at the new SHA.
3. Update the SHA in this README.
4. Run `pytest tests/golden -- --snapshot-update` and review the diff.
5. Commit as `chore(vendor): refresh premiere-pro-mcp to <sha>`.
```

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry/profiles/_vendor
git commit -m "chore(vendor): vendor premiere-pro-mcp schemas (MIT)"
```

---

### Task 40: Premiere profile referencing the vendor

**Files:**
- Modify: `backend/chatcut_backend/registry/profiles/premiere.py`
- Test: `backend/tests/unit/test_premiere_profile.py` (extend)

- [ ] **Step 1: Extend the test**

Add to the existing `test_premiere_profile.py`:

```python
def test_premiere_profile_supports_vendor_tools():
    from chatcut_backend.registry.profiles._vendor.premiere_pro_mcp.tools import VENDOR_TOOLS

    # Vendor adds many more tools than the 14 May-15 surface; for the May 15 milestone
    # we only require that the canonical 14 are present. Vendor expansion is opt-in
    # behind a feature flag.
    vendor_names = {t.name for t in VENDOR_TOOLS}
    assert len(vendor_names) > 14
```

- [ ] **Step 2: Run, fail (assuming the import path doesn't yet exist)**

- [ ] **Step 3: Wire in vendor tools (opt-in)**

Modify `premiere.py` to import the vendor tool list but keep `PREMIERE_PROFILE` exposing only the 14 canonical names by default; add `PREMIERE_VENDOR_PROFILE` that exposes the full vendor set. The orchestrator continues to default to `PREMIERE_PROFILE` for May 15.

- [ ] **Step 4: Run, pass**

- [ ] **Step 5: Commit**

```bash
git add backend/chatcut_backend/registry/profiles/premiere.py \
        backend/tests/unit/test_premiere_profile.py
git commit -m "feat(backend): wire vendored Premiere schemas (opt-in)"
```

---

### Task 41: stdio MCP transport

**Files:**
- Create: `backend/chatcut_backend/transports/stdio_mcp.py`
- Test: `backend/tests/integration/test_stdio_mcp_smoke.py`

- [ ] **Step 1: Failing smoke test**

`backend/tests/integration/test_stdio_mcp_smoke.py`:

```python
import asyncio

import pytest

from chatcut_backend.transports.stdio_mcp import build_server


@pytest.mark.asyncio
async def test_server_lists_canonical_tools():
    server = build_server()
    tools = await server.list_tools()
    names = {t.name for t in tools}
    expected = {
        "zoom_in", "zoom_out", "apply_filter", "apply_transition", "apply_blur",
        "modify_parameter", "apply_audio_filter", "adjust_volume", "ask_clarification",
        "get_selected_clips", "get_clip_parameters", "get_active_sequence_info",
        "get_playhead_position", "list_applied_effects",
    }
    assert expected <= names


@pytest.mark.asyncio
async def test_call_tool_returns_client_executes_marker():
    server = build_server()
    result = await server.call_tool("zoom_in", {"endScale": 200})
    # Spec: every tool returns a client_executes marker; the MCP client unwraps locally.
    assert any("client_executes" in str(item) for item in result)
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement**

`backend/chatcut_backend/transports/stdio_mcp.py`:

```python
"""stdio MCP transport — exposes canonical tools, marks them as client-executed."""
from __future__ import annotations

import asyncio

import mcp.server.stdio
import mcp.types as mcp_types
from mcp.server import Server

from chatcut_backend.llm._shared.tool_adapters import canonical_to_mcp
from chatcut_backend.registry.canonical import CANONICAL_TOOLS


def build_server() -> Server:
    server = Server("chatcut-backend")

    @server.list_tools()
    async def list_tools() -> list[mcp_types.Tool]:
        return canonical_to_mcp(CANONICAL_TOOLS)

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[mcp_types.TextContent]:
        # Server does not execute tools — clients do. Return a marker payload.
        return [
            mcp_types.TextContent(
                type="text",
                text=(
                    f'{{"client_executes": true, "tool": "{name}", '
                    f'"arguments": {arguments!r}}}'
                ),
            )
        ]

    return server


def run() -> None:
    server = build_server()

    async def _main():
        async with mcp.server.stdio.stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    asyncio.run(_main())


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: Run, pass**

```bash
cd backend && uv run pytest tests/integration/test_stdio_mcp_smoke.py -v
```

- [ ] **Step 5: Manual smoke from the CLI**

```bash
cd backend && uv run python -m chatcut_backend.transports.stdio_mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

(Exact JSON-RPC envelope depends on the MCP SDK version; confirm via `python -m mcp --help` or the SDK README.)

- [ ] **Step 6: Commit**

```bash
git add backend/chatcut_backend/transports/stdio_mcp.py \
        backend/tests/integration/test_stdio_mcp_smoke.py
git commit -m "feat(backend): stdio MCP transport (client-executed tools)"
```

---

### Task 42: Tauri sidecar smoke test (manual)

**Files:**
- Create: `web/src-tauri/scripts/spawn-mcp-sidecar.md`

This is a manual smoke; not part of the automated test suite. Document the procedure so any engineer can re-run.

- [ ] **Step 1: Document the smoke**

`web/src-tauri/scripts/spawn-mcp-sidecar.md`:

```markdown
# Tauri ↔ stdio MCP smoke

1. From `backend/`, run:
   ```bash
   uv run python -m chatcut_backend.transports.stdio_mcp
   ```
   Leave it running.
2. From a separate terminal, drive it with the `mcp` CLI:
   ```bash
   uvx mcp inspect stdio uv run python -m chatcut_backend.transports.stdio_mcp
   ```
3. Confirm the inspector shows 14 tools.
4. Call `get_playhead_position` with `{}` — expect a `client_executes` payload.

When this passes, the stdio path is verified. The Tauri app does not yet
spawn the sidecar in production code (post-deadline work).
```

- [ ] **Step 2: Commit**

```bash
git add web/src-tauri/scripts/spawn-mcp-sidecar.md
git commit -m "docs(web): manual stdio MCP sidecar smoke procedure"
```

---

### Task 43: README + onboarding docs

**Files:**
- Create: `backend/README.md`
- Create: `backend/chatcut_backend/registry/profiles/README.md`

- [ ] **Step 1: Backend README**

`backend/README.md`:

```markdown
# ChatCut Backend (MCP migration)

The backend exposes a single `POST /api/turn` endpoint that drives multi-turn
tool-use loops with Claude / Gemini / Groq, plus a stdio MCP transport for
future Tauri-native consumption. See `docs/superpowers/specs/2026-04-22-backend-mcp-migration-design.md`
for the full design.

## Run

```bash
cd backend
uv sync --all-extras
uv run uvicorn chatcut_backend.transports.http:app --reload
```

## stdio MCP

```bash
uv run python -m chatcut_backend.transports.stdio_mcp
```

## Test

```bash
uv run pytest tests/ -v
```

Golden snapshots live in `tests/golden/`. To update after a deliberate schema change:

```bash
uv run pytest tests/golden -- --snapshot-update
git diff tests/golden  # review the diff before committing
```

## Adding an NLE profile

See `chatcut_backend/registry/profiles/README.md`.

## Refreshing the vendored Premiere schemas

See `chatcut_backend/registry/profiles/_vendor/README.md`.
```

- [ ] **Step 2: Profile README**

`backend/chatcut_backend/registry/profiles/README.md`:

```markdown
# Capability profiles

A profile selects which canonical tools an NLE supports and (optionally) maps
canonical ids to NLE-native ids.

## Adding a profile (e.g. Final Cut Pro)

1. Create `chatcut_backend/registry/profiles/fcp.py`:
   ```python
   from chatcut_backend.registry.filters import CapabilityProfile

   FCP_PROFILE = CapabilityProfile(
       id="fcp",
       supported={
           "zoom_in": "Transform.Scale",
           # ... map every supported canonical name
       },
       excluded={"apply_audio_filter"},  # if FCP doesn't support it yet
       translations={},
   )
   ```
2. Register in `chatcut_backend/orchestrator/turn.py`:
   ```python
   from chatcut_backend.registry.profiles.fcp import FCP_PROFILE
   PROFILES["fcp"] = FCP_PROFILE
   ```
3. Add the client-side adapter that translates canonical args to FCP API calls.
4. Add `tests/unit/test_fcp_profile.py`.

The orchestrator and providers do not change.
```

- [ ] **Step 3: Commit**

```bash
git add backend/README.md backend/chatcut_backend/registry/profiles/README.md
git commit -m "docs(backend): README + profile onboarding"
```

---

## Self-review checklist (run after the plan is followed end-to-end)

Before declaring the migration "done" for the May 15 deadline, confirm against the spec's acceptance criteria (Section 15):

- [ ] `POST /api/turn` accepts the documented payload and returns a typed `Step`
- [ ] `/health` reports three configured providers (assuming all three keys set)
- [ ] Canonical registry exports 14 tools; golden snapshots green for all three providers
- [ ] Both clients have a working multi-turn loop runner using `/api/turn` for at least one call site
- [ ] All tests under `backend/tests/` pass against the new code paths
- [ ] `python -m chatcut_backend.transports.stdio_mcp` starts and serves the canonical tools list
- [ ] README documents how to add a new NLE profile and refresh the vendor

---

## Spec coverage map

| Spec section | Covered by tasks |
|---|---|
| 4. Architecture & data flow | 5, 9, 17, 28, 29, 41 |
| 5. Project layout | 1–11 (skeleton tasks) |
| 6. Tool registry & schema sourcing | 6–16, 39–40 |
| 7. Provider interface | 17–19, 27 |
| 8. Claude provider specifics | 20–24 |
| 9. MCP server (transports) | 28, 33, 41 |
| 10. Client multi-turn loop changes | 35–38 |
| 11. Migration steps (week-by-week) | this entire plan |
| 12. Risks & mitigations | observed during execution; revisit after Task 24 |
| 13. Open questions (deferred) | not in scope |
| 14. Tauri ffmpeg cleanup appendix | not in scope (separate track) |
| 15. Acceptance criteria | self-review checklist above |
