# CLAUDE.md — Math Tutor Codebase Guide

This file provides context for AI assistants working on this codebase.

---

## Project Overview

**Math Tutor** is an AI-powered math tutoring application. It combines a freehand drawing canvas with streaming AI chat.

It has **two session modes**, and the distinction drives much of the codebase:

| Mode | `sessionType` | AI behavior |
|---|---|---|
| **Problem** (default) | `'problem'` | Socratic. Guides with escalating hints, **never** gives the answer. |
| **Notes** | `'note'` | Study mode. Explains concepts **directly**, including answers. |

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Styling:** Tailwind CSS 4
- **AI Providers:** Anthropic Claude, OpenAI, Google Gemini, Groq, Ollama (local)
- **Persistence:** IndexedDB (sessions), localStorage (model config, rate limit)

---

## Repository Structure

```
src/
├── app/
│   ├── api/tutor/route.ts     # Streaming API endpoint (Anthropic + OpenAI-compat)
│   ├── page.tsx               # Root page (renders AppShell)
│   ├── layout.tsx             # Root layout (metadata, fonts)
│   └── globals.css            # Global Tailwind styles
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx       # Top-level app container; wires contexts + UI
│   │   ├── TopBar.tsx         # Header bar (New dropdown, Save, Load, Settings, Chat toggle)
│   │   ├── BottomToolbar.tsx  # Drawing tools (pen, eraser, select, pan), colors, undo/redo
│   │   ├── SettingsModal.tsx  # Model/provider configuration (defines PRESETS array)
│   │   └── HelpQuestionModal.tsx  # Custom question input with voice
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Freehand canvas (dual-canvas: draw + overlay); exposes DrawingCanvasHandle
│   │   ├── ProblemStatement.tsx   # Textarea + problem-image capture (problem mode)
│   │   └── NoteHeader.tsx     # Topic input (notes mode) — replaces ProblemStatement
│   ├── chat/
│   │   ├── ChatPanel.tsx      # Chat display and scroll container
│   │   ├── ChatMessage.tsx    # Individual message bubble
│   │   └── ChatInput.tsx      # Follow-up message input
│   └── sessions/
│       ├── SessionList.tsx    # Saved sessions modal
│       └── SessionCard.tsx    # Session preview card (📐 problem / 📝 note)
├── context/
│   ├── CanvasContext.tsx      # Canvas state (tool, color, strokes, undo/redo, selection)
│   └── SessionContext.tsx     # Session state (problem, chat history, sessionType, sessions)
├── hooks/
│   ├── useCanvas.ts           # Pointer event handling, stroke recording, replay, canvas capture
│   ├── useSelection.ts        # Overlay canvas selection rectangle logic
│   ├── useSpeechRecognition.ts# Web Speech API wrapper with error recovery
│   ├── useTutorChat.ts        # Sends requests to /api/tutor, handles SSE stream
│   └── useRateLimit.ts        # 5-min cooldown enforcement via localStorage
├── lib/
│   ├── db.ts                  # IndexedDB CRUD for sessions via `idb`
│   ├── modelConfig.ts         # localStorage get/set for ModelConfig
│   ├── constants.ts           # App-wide constants (colors, thicknesses, RATE_LIMIT_MS, CANVAS_HEIGHT)
│   └── canvasUtils.ts         # canvasToBlob → Blob (for saving to IndexedDB)
└── types/
    ├── index.ts               # All shared TypeScript types
    └── speech-recognition.d.ts# Web Speech API type declarations
```

---

## Key Conventions

### TypeScript
- Strict mode is on. All types must be explicit; avoid `any`.
- Shared types live in `src/types/index.ts`. Add new types there, not inline.
- Path alias `@/*` resolves to `src/*`. Always use this for imports within `src/`.

### State Management
- Global state uses React Context + `useReducer`. Do **not** introduce external state libraries (Redux, Zustand, etc.).
- **CanvasContext** owns all drawing state. Never manage strokes in a component.
- **SessionContext** owns all session/chat state, including `sessionType`. Components dispatch actions; they do not mutate state directly.

### Components
- Components should be pure presentational where possible; logic belongs in hooks.
- Custom hooks encapsulate complex behavior (`useCanvas`, `useTutorChat`, etc.). Follow this pattern for new features.
- Modals are conditionally rendered inside `AppShell`; control their visibility with boolean state in `AppShell` or a context.
- Anything reading `localStorage` must do so in an effect, not in `useState` initializers — that causes hydration mismatches. `AppShell` (model label) and `SettingsModal` both follow this.

### Styling
- Use Tailwind CSS utility classes only. No CSS modules, no `styled-components`.
- No dark mode is implemented. Do not add one without explicit request.
- Buttons follow a consistent pattern: base classes + hover/disabled variants. Match existing button styles.

### Canvas
- The drawing canvas uses **two overlapping `<canvas>` elements**: the main drawing canvas and a transparent overlay for selection UI.
- Both canvases scale by `window.devicePixelRatio` for crisp rendering on high-DPI screens.
- The canvas has a **fixed logical height of `CANVAS_HEIGHT` (3000px)** and lives inside an `overflow-y-auto` wrapper in `AppShell`. It is taller than the viewport by design so students can scroll for more room.
- Always use `replayStrokes` to reconstruct canvas from stored strokes (do not cache pixel data for undo).
- Erasing uses `globalCompositeOperation = 'destination-out'` on the canvas context.
- `DrawingCanvas` exposes a `DrawingCanvasHandle` ref with `captureFullCanvas()`, `captureRegion(rect)`, and `getCanvas()`. These are implemented in `useCanvas.ts`.
- `canvasUtils.ts` only contains `canvasToBlob` (for converting canvas to a `Blob` to store in IndexedDB). Do not add capture logic there.
- **Overlay clearing:** `useSelection` repaints the overlay only from its own pointer handlers. Any code path that clears `selection` in state (e.g. `ERASE_SELECTION`) must also clear the overlay — `DrawingCanvas` has an effect that does this when `selection` becomes `null`. Keep it when touching selection logic.
- **Gotcha:** `captureFullCanvas()` serializes the entire 3000px-tall canvas (6000px at dpr 2), so a full-canvas help request sends a large, mostly-blank PNG. Prefer `captureRegion` when a selection exists (`AppShell` already does).

### Undo / Redo
- `CanvasContext` keeps **snapshot stacks**: `past: Stroke[][]` and `future: Stroke[][]`, plus the current `strokes`.
- Any mutating action (`ADD_STROKE`, `CLEAR`, `ERASE_SELECTION`) pushes the previous `strokes` onto `past` and empties `future`.
- Gate undo/redo UI on `past.length` / `future.length` — **not** on `strokes.length`.
- `LOAD_STROKES` resets both stacks.
- `ERASE_SELECTION` splits each stroke into runs of consecutive points **outside** the selection, so strokes are clipped at the boundary rather than deleted wholesale.

### API Route (`/api/tutor`)
- Supports two provider paths: **Anthropic** (`@anthropic-ai/sdk`) and **OpenAI-compatible** (`openai` SDK).
- Always returns a **streaming response** using Server-Sent Events. Do not convert to a non-streaming response.
- **Two system prompts**, selected by `sessionType`:
  - `SYSTEM_PROMPT` (default / `'problem'`) — Socratic, hints only, never the answer.
  - `NOTE_SYSTEM_PROMPT` (`'note'`) — direct explanations, may state answers.
- Images are passed as base64 PNG. When `problemImage` is present it is sent **first** and described to the model as the problem figure; the canvas image follows as the student's work.
- The API cleans message history to ensure valid alternating user/assistant turns before sending to the model (Anthropic path only).
- Request body shape: `{ problemStatement, chatHistory, canvasImage, modelConfig, userQuestion?, problemImage?, sessionType? }` (see `TutorRequest` in `src/types/index.ts`).
- The OpenAI path falls back to the API key string `'ollama'` when `OPENAI_API_KEY` is unset, so local Ollama works with no key.

### Session Persistence
- Sessions are stored in IndexedDB using the `idb` library (`src/lib/db.ts`). Do not use `localStorage` for session data.
- `db.ts` exports: `saveSession`, `loadSession`, `deleteSession`, `listSessions`.
- Session fields: `id`, `title`, `problemStatement`, `problemImage`, `canvasStrokes`, `canvasImageBlob`, `chatHistory`, `createdAt`, `updatedAt`, `isSolved?`, `sessionType?`.
- `SessionMetadata` (used for session list): `id`, `title`, `problemStatement`, `createdAt`, `updatedAt`, `messageCount`, `isSolved?`, `sessionType?`.
- `sessionType` and `isSolved` are optional for backward compatibility with sessions saved before those fields existed. Treat missing `sessionType` as `'problem'`.
- Model configuration (provider, model ID, base URL) is stored in `localStorage` via `src/lib/modelConfig.ts`.

---

## Development Workflow

### Setup
```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env.local  # (or create manually)
# Add at minimum: ANTHROPIC_API_KEY=<your-key>

# Start development server
npm run dev   # http://localhost:3000
```

**Node 20+ is required** (Next.js 16). Older Node versions fail with `Cannot find module 'node:events'`.

### Environment Variables
| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For Anthropic/Claude | Anthropic API key |
| `OPENAI_API_KEY` | For OpenAI-compat | OpenAI / Google / Groq key (not needed for Ollama) |
| `NEXT_PUBLIC_OLLAMA_BASE_URL` | No | Overrides the default Ollama preset URL (`http://localhost:11434/v1`) — useful when Ollama runs on another machine |

The app shows user-friendly error messages for missing/invalid keys.

### Scripts
```bash
npm run dev    # Development server (port 3000)
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```

### Linting
ESLint uses the Next.js core web vitals config. Run `npm run lint` before committing. There is no Prettier config; formatting follows ESLint rules.

---

## Core Data Flow

### Help Request (primary user flow)
1. User writes the problem in `ProblemStatement` (or a topic in `NoteHeader`), draws on `DrawingCanvas`.
2. Clicks **Ask for Help** (problem mode) / **Ask About This** (notes mode) → `HelpQuestionModal` opens (optional custom question + voice).
3. On submit: `AppShell.handleAskForHelp()` calls `canvasHandle.current.captureRegion(selection)` when a region is selected, else `captureFullCanvas()` → base64 PNG.
4. `useTutorChat.sendHelp(canvasImage, question)` POSTs to `/api/tutor` with the request body above, including `sessionType`.
5. API selects the system prompt from `sessionType` and streams an SSE response; client appends `text_delta` events to chat in real time via `APPEND_TO_LAST_MESSAGE` dispatch.
6. Session is **not auto-saved**; user must click **Save** manually.

### Follow-up Chat
- `useTutorChat.sendFollowUp(text)` sends text-only follow-up messages (no image) via the same `/api/tutor` endpoint.

### Session Save/Load
- **Save:** `handleSave` in `AppShell` calls `db.saveSession()` with current canvas strokes + chat + `sessionType`.
- **Load:** `handleLoad` calls `db.loadSession()`, dispatches to both contexts to restore state.
- **New:** the **New** button in `TopBar` is a dropdown — *New Problem* or *New Notes* — which passes a `SessionType` to `AppShell.handleNew()`.

### Keyboard Shortcuts
Registered once in `AppShell` (handlers read latest values through refs):

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+S` | Save session |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Erase the selected region (when a selection exists) |

Shortcuts are ignored while focus is in an `input`, `textarea`, or contenteditable element.

### Rate Limiting
- `useRateLimit` enforces a 5-minute cooldown (`RATE_LIMIT_MS = 300000` in `constants.ts`) between help requests.
- Timestamp persisted to `localStorage`; returns `{ isLimited, remainingMs, recordUsage, formatRemaining }`.

---

## AI Provider Configuration

Configured via `SettingsModal` and stored in `localStorage`. Provider presets are defined as the `PRESETS` array inside `SettingsModal.tsx` (not in `constants.ts`):

| Provider | SDK Used | Default Model | Base URL |
|---|---|---|---|
| Anthropic (Claude) | `@anthropic-ai/sdk` | `claude-sonnet-4-5-20250929` | Default (api.anthropic.com) |
| OpenAI | `openai` (compat) | `gpt-4o` | `https://api.openai.com/v1` |
| Google Gemini | `openai` (compat) | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Groq | `openai` (compat) | `llama-3.3-70b-versatile` | `https://api.groq.com/openai/v1` |
| Ollama | `openai` (compat) | `llama3.2-vision` | `NEXT_PUBLIC_OLLAMA_BASE_URL` ?? `http://localhost:11434/v1` |
| Custom | `openai` (compat) | User-specified | User-specified |

The Base URL field is editable for **every** OpenAI-compatible provider (not just Custom), so a remote Ollama or a proxy can be pointed at without picking Custom.

Default model config (when nothing is saved in localStorage): `anthropic` / `claude-sonnet-4-5-20250929`.

---

## Common Patterns

### Adding a new API provider
1. Add a preset entry to the `PRESETS` array in `src/components/layout/SettingsModal.tsx`.
2. The API route auto-routes to the OpenAI SDK for any non-Anthropic provider; no route changes needed for OpenAI-compatible APIs.

### Adding a new canvas tool
1. Add the tool name to the `DrawingTool` union in `src/types/index.ts` (currently `'pen' | 'eraser' | 'select' | 'pan'`).
2. Add handling in `useCanvas.ts` (drawing tools) or `useSelection.ts` (overlay tools). Tools that manipulate the *viewport* rather than pixels — like `pan`, which scrolls the wrapper element — are handled directly in `DrawingCanvas.tsx`.
3. Wire the pointer handlers in `DrawingCanvas`, which dispatches to the right handler set based on `toolSettings.activeTool`.
4. Add a button to `BottomToolbar.tsx`.
5. Update `CanvasContext` state/reducer if new tool settings are needed.

### Adding a new session field
1. Update `Session` and `SessionMetadata` types in `src/types/index.ts`.
2. Update the `MathTutorDB` schema and read/write logic in `db.ts`.
3. Update `LOAD_SESSION` / `NEW_SESSION` actions in `SessionContext.tsx`.
4. Pass it through `handleSave` / `handleLoad` in `AppShell.tsx`.
5. Make it optional (`field?:`) so previously saved sessions still load.

---

## Important Constraints

- **Do not weaken the Socratic constraint in `SYSTEM_PROMPT`.** Problem mode must never give full solutions. Note that `NOTE_SYSTEM_PROMPT` is *intentionally* direct — that is not a bug, and the two prompts must stay distinct.
- **Do not break streaming.** The API must remain SSE-based. Don't convert to JSON responses.
- **Do not replace the canvas architecture.** The dual-canvas + stroke-replay pattern is intentional for undo/redo and region capture.
- **Do not add dark mode** unless explicitly requested.
- **Do not introduce new state management libraries.** Use React Context + useReducer.
- **Rate limiting is intentional.** Do not remove or reduce the 5-minute cooldown without explicit direction.
</content>
