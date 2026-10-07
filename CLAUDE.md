# CLAUDE.md — Math Tutor Codebase Guide

This file provides context for AI assistants working on this codebase.

---

## Project Overview

**Math Tutor** is an AI-powered math tutoring application. It combines a [tldraw](https://tldraw.dev) whiteboard with streaming AI chat.

It has **two session modes**, and the distinction drives much of the codebase:

| Mode | `sessionType` | AI behavior |
|---|---|---|
| **Problem** (default) | `'problem'` | Socratic. Guides with escalating hints, **never** gives the answer. |
| **Notes** | `'note'` | Study mode. Explains concepts **directly**, including answers. |

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Canvas:** tldraw 5 (pinned together with `@tldraw/assets`)
- **Styling:** Tailwind CSS 4
- **AI Providers:** Anthropic Claude, OpenAI, Google Gemini, Groq, Ollama (local), and the student's own ChatGPT plan via Sign in with ChatGPT
- **Persistence:** IndexedDB (sessions), localStorage (model config)

---

## Repository Structure

```
src/
├── app/
│   ├── api/tutor/route.ts     # Streaming API endpoint (Anthropic + OpenAI-compat + ChatGPT plan)
│   ├── api/chatgpt/route.ts   # Sign in with ChatGPT: status, sign-in, sign-out
│   ├── page.tsx               # Root page (renders AppShell)
│   ├── layout.tsx             # Root layout (metadata, fonts)
│   └── globals.css            # Global Tailwind styles
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx       # Top-level app container; wires contexts + UI
│   │   ├── TopBar.tsx         # Header bar (New dropdown, Save, Load, Settings, Chat toggle)
│   │   ├── BottomToolbar.tsx  # Clear, Mark Solved, Ask for Help (drawing tools are tldraw's own)
│   │   ├── SettingsModal.tsx  # Model/provider configuration (defines PRESETS array)
│   │   └── HelpQuestionModal.tsx  # Custom question input with voice
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Client-only wrapper around TldrawCanvas; defines DrawingCanvasHandle
│   │   ├── TldrawCanvas.tsx   # tldraw editor: loads documents, mirrors them to CanvasContext, exports images
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
│   ├── CanvasContext.tsx      # Mirror of the tldraw document + pending load requests
│   └── SessionContext.tsx     # Session state (problem, chat history, sessionType, sessions)
├── hooks/
│   ├── useSpeechRecognition.ts# Web Speech API wrapper with error recovery
│   ├── useTutorChat.ts        # Sends requests to /api/tutor, handles SSE stream
│   └── useChatGPTConnection.ts# Sign in with ChatGPT state for SettingsModal
├── lib/
│   ├── db.ts                  # IndexedDB CRUD for sessions via `idb`
│   ├── modelConfig.ts         # localStorage get/set for ModelConfig
│   ├── chatgpt.ts             # Server-only Sign in with ChatGPT client + OS-keychain token encryption
│   ├── siwc/                  # Vendored OpenAI Sign in with ChatGPT SDK (noncommercial license, see below)
│   ├── constants.ts           # App-wide constants (ChatGPT usage URL, default plan model)
│   └── legacyStrokes.ts       # Converts pre-tldraw saved strokes into tldraw draw shapes
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
- **tldraw's editor** owns the live drawing, tools, selection and undo history. **CanvasContext** mirrors what the rest of the app needs (`document`, `hasContent`) and carries `LOAD` requests; don't duplicate drawing state elsewhere.
- **SessionContext** owns all session/chat state, including `sessionType`. Components dispatch actions; they do not mutate state directly.

### Components
- Components should be pure presentational where possible; logic belongs in hooks.
- Custom hooks encapsulate complex behavior (`useTutorChat`, `useSpeechRecognition`, etc.). Follow this pattern for new features.
- Modals are conditionally rendered inside `AppShell`; control their visibility with boolean state in `AppShell` or a context.
- Anything reading `localStorage` must do so in an effect, not in `useState` initializers — that causes hydration mismatches. `AppShell` (model label) and `SettingsModal` both follow this.

### Styling
- Use Tailwind CSS utility classes only. No CSS modules, no `styled-components`.
- No dark mode is implemented. Do not add one without explicit request.
- Buttons follow a consistent pattern: base classes + hover/disabled variants. Match existing button styles.

### Canvas
- The canvas is **tldraw**, mounted by `TldrawCanvas.tsx` through `DrawingCanvas.tsx`, which loads it with `next/dynamic` and `ssr: false`. `DrawingCanvas` fills its nearest positioned ancestor, so the wrapper in `AppShell` / `Workbook` must be `relative` with a size.
- `DrawingCanvasHandle` (pass a ref as `handleRef`): `captureImage()` exports the selected shapes, else every shape, trimmed to their bounds (PNG, pixelRatio 2, base64 without the `data:` prefix; `''` when empty); `captureThumbnail()`, `getDocument()`, `getRevision()` (bumped synchronously on every document change), and `clear()` (one undoable step).
- tldraw's UI supplies the tools, colors, undo/redo and their shortcuts. `MainMenu`, `PageMenu`, `HelpMenu` and debug panels are hidden and there is one page per session.
- `CanvasContext.document` is a **debounced** (250ms) copy of the editor's document. When saving, read `getDocument()` from the handle (both `AppShell` and `Workbook` do), or the last stroke can be missed.
- Loading: dispatch `LOAD` with `document` (tldraw format) and/or `strokes` (pre-tldraw format). The editor applies it when mounted, clears undo history, then dispatches `LOADED`. Until then `pendingLoad` holds the strokes, and saves keep them so an unconverted old session is never overwritten with an empty board.
- Old sessions: `legacyStrokes.ts` turns strokes into draw shapes. The old canvas erased with `destination-out`, so pen ink under a *later* eraser stroke's swept path (its segments, not just its sampled points) is dropped.
- **Assets:** fonts, icons and translations are copied from `@tldraw/assets` into `public/tldraw-assets` (gitignored) by the `postinstall` script, so nothing loads from tldraw's CDN. Keep `tldraw` and `@tldraw/assets` on the same exact version.
- **License:** with no license key tldraw runs on `http://localhost` / `127.0.0.1` (any http origin counts as development) and shows a small "Get a license for production" note. A hosted deployment needs a key from tldraw.dev.

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
- A third path, `provider: 'chatgpt'`, uses Sign in with ChatGPT: the Responses API with the student's OAuth token, billed to their ChatGPT plan instead of an API key. Images go as `input_image` parts.

### Sign in with ChatGPT
- The SDK is **not on npm**; `src/lib/siwc/` is a copy of `packages/local/src` from `openai/sign-in-with-chatgpt-devkit`. Each file's header says what changed from upstream (keep doing that, the license requires it). Keep edits there minimal; app logic goes in `src/lib/chatgpt.ts`.
- **License:** the SDK is under OpenAI's *Sign-in with ChatGPT DevKit Noncommercial License v1.0* (`src/lib/siwc/LICENSE`). Commercial use needs a separate agreement with OpenAI.
- OAuth runs in the Next server process (which is on the student's machine) and opens their browser; the callback listens on `127.0.0.1:${CHATGPT_REDIRECT_PORT ?? 8791}`. The port is registered on first sign-in, so don't change it casually.
- Tokens are saved under `~/.config/math-tutor/`, encrypted with a key kept in the OS keychain via `@napi-rs/keyring`. With no keychain (e.g. Linux without Secret Service, CI containers), sign-in reports that secure storage is unavailable; there is deliberately no plaintext fallback.
- Tokens never reach the browser: `/api/chatgpt` returns only `ChatGPTStatus` (status, email, models).
- There is no API for remaining plan quota. The ChatGPT path streams a `usage` SSE event (input/output tokens from `response.completed`) that is stored on the assistant `ChatMessage` and shown under it with a **Manage usage** link to `CHATGPT_USAGE_URL` (`chatgpt.com/settings/usage`, where students see per-app usage and set a weekly cap).
- Only for a locally run app. A hosted deployment would need OpenAI's waitlist approval and a different (non-loopback) flow.

### Session Persistence
- Sessions are stored in IndexedDB using the `idb` library (`src/lib/db.ts`). Do not use `localStorage` for session data.
- `db.ts` exports: `saveSession`, `loadSession`, `deleteSession`, `listSessions`.
- Session fields: `id`, `title`, `problemStatement`, `problemImage`, `canvasStrokes` (pre-tldraw only), `canvasDocument?`, `canvasImageBlob`, `chatHistory`, `createdAt`, `updatedAt`, `isSolved?`, `sessionType?`.
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

**Node 22+ is required** (the Sign in with ChatGPT SDK targets 22; Next.js 16 itself needs 20+). Older Node versions fail with `Cannot find module 'node:events'`.

### Environment Variables
| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For Anthropic/Claude | Anthropic API key |
| `OPENAI_API_KEY` | For OpenAI-compat | OpenAI / Google / Groq key (not needed for Ollama) |
| `CHATGPT_REDIRECT_PORT` | No | Loopback port for the Sign in with ChatGPT callback (default `8791`) |
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
3. On submit: `AppShell.handleAskForHelp()` calls `canvasHandle.current.captureImage()` → base64 PNG of the selected shapes, or of the whole drawing trimmed to its bounds.
4. `useTutorChat.sendHelp(canvasImage, question)` POSTs to `/api/tutor` with the request body above, including `sessionType`.
5. API selects the system prompt from `sessionType` and streams an SSE response; client appends `text_delta` events to chat in real time via `APPEND_TO_LAST_MESSAGE` dispatch.
6. Session is **not auto-saved**; user must click **Save** manually.

### Follow-up Chat
- `useTutorChat.sendFollowUp(text, canvasImage?)` uses the same `/api/tutor` endpoint. `AppShell` (via `ChatPanel` → `ChatInput`) and `Workbook` attach a fresh `captureImage()` only when the handle's `getRevision()` changed since the tutor last saw the board; otherwise the follow-up is text-only. Don't use the debounced `CanvasContext.document` for this: it misses a stroke finished just before sending.

### Session Save/Load
- **Save:** `handleSave` in `AppShell` calls `db.saveSession()` with the tldraw document (`canvasDocument`), a thumbnail, chat and `sessionType`. New saves write `canvasStrokes: []`.
- **Load:** `handleLoad` calls `db.loadSession()`, dispatches to both contexts to restore state.
- **New:** the **New** button in `TopBar` is a dropdown — *New Problem* or *New Notes* — which passes a `SessionType` to `AppShell.handleNew()`.

### Keyboard Shortcuts
Registered once in `AppShell` (handlers read latest values through refs):

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+S` | Save session |

Undo, redo, delete and tool keys are tldraw's own. Shortcuts are ignored while focus is in an `input`, `textarea`, or contenteditable element.

### Rate Limiting
- There is no app-side cooldown between help requests (the old 5-minute `useRateLimit` was removed on request). Spending is bounded by the provider: API-key billing, or the ChatGPT plan's own limits and per-app weekly cap.

---

## AI Provider Configuration

Configured via `SettingsModal` and stored in `localStorage`. Provider presets are defined as the `PRESETS` array inside `SettingsModal.tsx` (not in `constants.ts`):

| Provider | SDK Used | Default Model | Base URL |
|---|---|---|---|
| Anthropic (Claude) | `@anthropic-ai/sdk` | `claude-sonnet-4-5-20250929` | Default (api.anthropic.com) |
| ChatGPT plan | vendored `src/lib/siwc` | First listed model matching `CHATGPT_DEFAULT_MODEL_PATTERN` (Luna), else the first listed | `https://api.openai.com/v1/responses` (fixed) |
| OpenAI | `openai` (compat) | `gpt-4o` | `https://api.openai.com/v1` |
| Google Gemini | `openai` (compat) | `gemini-3-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
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

### Customizing the canvas
- Tools, menus and the style panel come from tldraw. Change them through `TldrawCanvas.tsx` (`components`, `overrides`, custom shapes/tools) rather than building UI around the editor.

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
- **Keep tldraw as the single source of truth for the drawing.** Don't add a parallel stroke store; mirror what you need through `CanvasContext`.
- **Do not add dark mode** unless explicitly requested.
- **Do not introduce new state management libraries.** Use React Context + useReducer.
</content>
