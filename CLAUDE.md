# CLAUDE.md — Math Tutor Codebase Guide

This file provides context for AI assistants working on this codebase.

---

## Project Overview

**Math Tutor** is an AI-powered Socratic math tutoring application. It combines a freehand drawing canvas with streaming AI chat to guide students through math problems using hints — never direct answers.

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
│   │   ├── TopBar.tsx         # Header bar (New, Save, Load, Settings)
│   │   ├── BottomToolbar.tsx  # Drawing tool controls (pen, eraser, select, colors)
│   │   ├── SettingsModal.tsx  # Model/provider configuration
│   │   └── HelpQuestionModal.tsx  # Custom question input with voice
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Freehand canvas (dual-canvas: draw + overlay)
│   │   └── ProblemStatement.tsx   # Textarea for the math problem
│   ├── chat/
│   │   ├── ChatPanel.tsx      # Chat display and scroll container
│   │   ├── ChatMessage.tsx    # Individual message bubble
│   │   └── ChatInput.tsx      # Follow-up message input
│   └── sessions/
│       ├── SessionList.tsx    # Saved sessions modal
│       └── SessionCard.tsx    # Session preview card
├── context/
│   ├── CanvasContext.tsx      # Canvas state (tool, color, strokes, undo/redo)
│   └── SessionContext.tsx     # Session state (problem, chat history, sessions)
├── hooks/
│   ├── useCanvas.ts           # Pointer event handling, stroke recording, replay
│   ├── useSelection.ts        # Overlay canvas selection rectangle logic
│   ├── useSpeechRecognition.ts# Web Speech API wrapper with error recovery
│   ├── useTutorChat.ts        # Sends requests to /api/tutor, handles SSE stream
│   └── useRateLimit.ts        # 5-min cooldown enforcement via localStorage
├── lib/
│   ├── db.ts                  # IndexedDB CRUD for sessions via `idb`
│   ├── modelConfig.ts         # localStorage get/set for ModelConfig
│   ├── constants.ts           # App-wide constants (colors, thicknesses, presets)
│   └── canvasUtils.ts         # captureCanvas / captureRegion → base64 PNG
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
- **SessionContext** owns all session/chat state. Components dispatch actions; they do not mutate state directly.

### Components
- Components should be pure presentational where possible; logic belongs in hooks.
- Custom hooks encapsulate complex behavior (`useCanvas`, `useTutorChat`, etc.). Follow this pattern for new features.
- Modals are conditionally rendered inside `AppShell`; control their visibility with boolean state in `AppShell` or a context.

### Styling
- Use Tailwind CSS utility classes only. No CSS modules, no `styled-components`.
- No dark mode is implemented. Do not add one without explicit request.
- Buttons follow a consistent pattern: base classes + hover/disabled variants. Match existing button styles.

### Canvas
- The drawing canvas uses **two overlapping `<canvas>` elements**: the main drawing canvas and a transparent overlay for selection UI.
- Both canvases scale by `window.devicePixelRatio` for crisp rendering on high-DPI screens.
- Always use `replayStrokes` to reconstruct canvas from stored strokes (do not cache pixel data for undo).
- Erasing uses `globalCompositeOperation = 'destination-out'` on the canvas context.

### API Route (`/api/tutor`)
- Supports two provider paths: **Anthropic** (`@anthropic-ai/sdk`) and **OpenAI-compatible** (`openai` SDK).
- Always returns a **streaming response** using Server-Sent Events. Do not convert to a non-streaming response.
- The system prompt enforces Socratic tutoring. Do **not** weaken or remove the "no direct answers" constraint.
- Canvas images are passed as base64 PNG in the message content. Skip image attachment when the canvas is blank.
- The API cleans message history to ensure valid alternating user/assistant turns before sending to the model.

### Session Persistence
- Sessions are stored in IndexedDB using the `idb` library (`src/lib/db.ts`). Do not use `localStorage` for session data.
- Sessions contain: `id`, `problem`, `strokes` (for canvas replay), `messages`, `createdAt`, `updatedAt`.
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

### Environment Variables
| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For Anthropic/Claude | Anthropic API key |
| `OPENAI_API_KEY` | For OpenAI-compat | OpenAI / Google / Groq key |

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
1. User writes problem in `ProblemStatement`, draws on `DrawingCanvas`.
2. Clicks **Ask for Help** → `HelpQuestionModal` opens (optional custom question + voice).
3. On submit: `useTutorChat.sendHelp()` calls `captureCanvas` or `captureRegion` → base64 PNG.
4. POST to `/api/tutor` with `{ problem, messages, imageData, question, modelConfig }`.
5. API streams SSE response; client appends `text_delta` events to chat in real time.
6. Session is **not auto-saved**; user must click **Save** manually.

### Session Save/Load
- **Save:** `handleSave` in `AppShell` calls `db.saveSession()` with current canvas strokes + chat.
- **Load:** `handleLoad` calls `db.getSession()`, dispatches to both contexts to restore state.
- **Keyboard shortcut:** `Cmd/Ctrl+S` triggers save.

### Rate Limiting
- `useRateLimit` enforces a 5-minute cooldown (`RATE_LIMIT_MS = 300000`) between help requests.
- Timestamp persisted to `localStorage`; button shows countdown timer while limited.

---

## AI Provider Configuration

Configured via `SettingsModal` and stored in `localStorage`:

| Provider | SDK Used | Base URL |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | Default (api.anthropic.com) |
| OpenAI | `openai` | Default |
| Google Gemini | `openai` (compat) | `https://generativeai.googleapis.com/...` |
| Groq | `openai` (compat) | `https://api.groq.com/openai/v1` |
| Ollama | `openai` (compat) | `http://localhost:11434/v1` |
| Custom | `openai` (compat) | User-specified |

Default model presets are in `src/lib/constants.ts`.

---

## Common Patterns

### Adding a new API provider
1. Add a preset entry to `MODEL_PRESETS` in `src/lib/constants.ts`.
2. Update `SettingsModal.tsx` if a new UI field is needed.
3. The API route auto-routes to OpenAI SDK for any non-Anthropic provider; no route changes needed for OpenAI-compatible APIs.

### Adding a new canvas tool
1. Add the tool name to the `DrawingTool` union type in `src/types/index.ts`.
2. Add handling in `useCanvas.ts` (pointer event logic) or `useSelection.ts`.
3. Add a button to `BottomToolbar.tsx`.
4. Update `CanvasContext` state/reducer if new tool settings are needed.

### Adding a new session field
1. Update `Session` and `SessionMetadata` types in `src/types/index.ts`.
2. Update `db.ts` to read/write the new field.
3. Update dispatch actions in `SessionContext.tsx`.

---

## Important Constraints

- **Do not give full solutions.** The system prompt explicitly enforces Socratic tutoring. Never modify the system prompt to weaken this constraint.
- **Do not break streaming.** The API must remain SSE-based. Don't convert to JSON responses.
- **Do not replace the canvas architecture.** The dual-canvas + stroke-replay pattern is intentional for undo/redo and region capture.
- **Do not add dark mode** unless explicitly requested.
- **Do not introduce new state management libraries.** Use React Context + useReducer.
- **Rate limiting is intentional.** Do not remove or reduce the 5-minute cooldown without explicit direction.
