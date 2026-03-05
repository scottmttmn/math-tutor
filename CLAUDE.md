# CLAUDE.md — Math Tutor AI Assistant Guide

This file provides guidance for AI assistants (Claude, etc.) working in this codebase.

---

## Project Overview

**Math Tutor** is a Next.js web application that provides an AI-powered Socratic math tutoring experience. Students can:
- Draw math problems on a canvas
- Type a problem statement
- Ask for guided hints (not direct answers) from an AI tutor
- Ask follow-up questions via text or voice
- Save/load sessions via IndexedDB

The app supports multiple AI providers: Anthropic (Claude), OpenAI-compatible APIs, Google Gemini, Groq, and Ollama.

---

## Development Commands

```bash
npm run dev     # Start Next.js development server on port 3000
npm run build   # Production build
npm start       # Run production server
npm run lint    # Run ESLint
```

No test runner is configured. Verify changes manually via the dev server.

---

## Directory Structure

```
src/
├── app/
│   ├── api/tutor/route.ts     # Streaming AI tutor API endpoint (SSE)
│   ├── page.tsx               # Root page — renders <AppShell>
│   ├── layout.tsx             # Root layout — Geist font, metadata
│   └── globals.css            # Global CSS reset and base styles
├── components/
│   ├── chat/
│   │   ├── ChatPanel.tsx      # Chat display with auto-scroll
│   │   ├── ChatMessage.tsx    # Message bubble with loading animation
│   │   └── ChatInput.tsx      # Follow-up text input
│   ├── layout/
│   │   ├── AppShell.tsx       # Main layout orchestrator; keyboard shortcuts
│   │   ├── TopBar.tsx         # Header: New/Save/Load/Settings buttons
│   │   ├── SettingsModal.tsx  # Provider/model selection and custom config
│   │   └── HelpQuestionModal.tsx  # Voice-enabled question input with image preview
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Dual-canvas drawing + selection overlay
│   │   └── ProblemStatement.tsx   # Textarea for problem text
│   └── sessions/
│       ├── SessionList.tsx    # Modal listing saved sessions
│       └── SessionCard.tsx    # Individual session card (load/delete)
├── context/
│   ├── CanvasContext.tsx      # Canvas state: strokes, tools, undo/redo
│   └── SessionContext.tsx     # Chat history, streaming state, session metadata
├── hooks/
│   ├── useCanvas.ts           # Pointer events, stroke recording, canvas capture
│   ├── useTutorChat.ts        # Streaming API calls to /api/tutor
│   ├── useRateLimit.ts        # 5-minute cooldown on help requests (localStorage)
│   ├── useSelection.ts        # Region selection on overlay canvas
│   └── useSpeechRecognition.ts  # Web Speech API integration
├── lib/
│   ├── db.ts                  # IndexedDB (idb) — session CRUD
│   ├── modelConfig.ts         # localStorage model config read/write
│   ├── canvasUtils.ts         # Canvas → Blob (PNG) conversion
│   └── constants.ts           # Color palette, brush thickness values, rate limit duration
└── types/
    ├── index.ts               # All core TypeScript interfaces
    └── speech-recognition.d.ts  # Web Speech API type declarations
```

---

## Architecture & Key Patterns

### State Management
- **React Context + useReducer** — no Redux or Zustand. Two contexts:
  - `CanvasContext`: strokes, current tool, undo/redo stacks
  - `SessionContext`: problem text, chat messages, streaming flag, session metadata
- Reducers follow the pattern: `(state, action) → newState`

### Canvas System
- **Dual-canvas architecture**: one canvas for drawing strokes, an invisible overlay canvas for region selection.
- Device pixel ratio (DPR) scaling is applied for sharp rendering on HiDPI displays.
- Undo/redo is stroke-based (array of stroke arrays), implemented in `CanvasContext`.
- Canvas snapshots are encoded as base64 PNG and sent to the AI API.

### API / Streaming
- The single backend endpoint is `POST /api/tutor` (`src/app/api/tutor/route.ts`).
- Responses are streamed as **Server-Sent Events (SSE)** using the Vercel AI streaming pattern.
- The hook `useTutorChat` handles stream parsing and appends text chunks to the session message.
- Both Anthropic SDK and OpenAI-compatible clients are supported.

### Multi-Provider Support
Provider configuration is stored in **localStorage** under `mathTutor_modelConfig`:
```ts
{
  provider: 'anthropic' | 'openai-compatible',
  model: string,       // e.g. 'claude-opus-4-6'
  baseUrl: string      // used for OpenAI-compatible endpoints
}
```
Presets for Anthropic, Google Gemini (via OpenAI-compat), Groq, and Ollama are defined in `SettingsModal.tsx`.

### Persistence
- **Sessions** (problem text, chat, canvas snapshot, strokes) are stored in **IndexedDB** via the `idb` library (`src/lib/db.ts`).
- **Model config** and **rate limit timestamps** live in **localStorage**.

### AI Tutor Behavior
- The system prompt in `src/app/api/tutor/route.ts` enforces **Socratic tutoring**: guide with questions and hints, never give direct answers.
- The system prompt is substantial (~8 KB); treat it as the core product logic.

---

## TypeScript Conventions

- **Strict mode** is enabled in `tsconfig.json`.
- Path alias `@/*` maps to `./src/*` — always use this for imports within `src/`.
- All types are centralized in `src/types/index.ts`. Add new shared types there.
- Client components must include `'use client'` at the top.
- Server components and API routes do **not** use `'use client'`.

---

## Styling Conventions

- **Tailwind CSS v4** via PostCSS.
- All styling uses Tailwind utility classes inline on JSX elements.
- No CSS modules, no `styled-components`.
- Global styles (resets, base font) are in `src/app/globals.css`.
- Color constants and tool values are in `src/lib/constants.ts` — use these rather than hard-coding.

---

## Environment Variables

| Variable | Purpose | Where set |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API | Server environment / `.env.local` |
| `OPENAI_API_KEY` | OpenAI-compatible APIs | Server environment / `.env.local` |

These are accessed server-side only inside `src/app/api/tutor/route.ts`. Never expose them to the client.

Create a `.env.local` file (git-ignored) for local development:
```
ANTHROPIC_API_KEY=your_key_here
```

---

## Component Conventions

- Use **named exports** for all components (no default export inconsistency).
- Use `useCallback` for event handlers passed as props or used in `useEffect` dependency arrays.
- Use **ref forwarding** (`forwardRef`) when a parent needs direct DOM access (e.g., canvas refs).
- Keep business logic in **hooks**, not in components.
- Components under `src/components/` are all client-side — they must have `'use client'`.

---

## Key Files to Understand First

When onboarding to this codebase, read these in order:

1. `src/types/index.ts` — understand the data model
2. `src/context/SessionContext.tsx` — session and chat state
3. `src/context/CanvasContext.tsx` — canvas and drawing state
4. `src/app/api/tutor/route.ts` — the AI endpoint and system prompt
5. `src/hooks/useTutorChat.ts` — how the frontend calls the API
6. `src/components/layout/AppShell.tsx` — how everything is wired together

---

## Git Workflow

- **Active development branch**: `claude/add-claude-documentation-YZsPb`
- `master` is the local base branch; `origin/main` is the remote default.
- Commit messages should be imperative and descriptive (e.g., `Add voice input support to HelpQuestionModal`).
- There is no CI/CD pipeline; lint manually with `npm run lint` before committing.

---

## Things That Do NOT Exist (Don't Add Without Discussion)

- No unit or integration tests — do not assume a test runner is available.
- No Redux/Zustand/Jotai — use React Context.
- No CSS modules or styled-components — use Tailwind.
- No server-side session storage — IndexedDB is client-side only.
- No authentication system.
- No database beyond IndexedDB.

---

## Common Tasks

### Add a new AI provider preset
Edit `src/components/layout/SettingsModal.tsx` — add an entry to the presets array with `{ label, provider, model, baseUrl }`.

### Modify the AI tutor's behavior
Edit the system prompt string in `src/app/api/tutor/route.ts`.

### Add a new drawing tool
1. Add the tool type to `src/types/index.ts`
2. Handle it in `src/context/CanvasContext.tsx` (state)
3. Add UI button in `src/components/layout/BottomToolbar.tsx`
4. Handle pointer logic in `src/hooks/useCanvas.ts`

### Add a new session field
1. Update `Session` type in `src/types/index.ts`
2. Update `SessionContext.tsx` (state and reducer)
3. Update `src/lib/db.ts` (IndexedDB schema / read/write)

### Change rate limit duration
Edit `RATE_LIMIT_MS` in `src/lib/constants.ts`.
