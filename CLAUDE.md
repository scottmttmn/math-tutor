# CLAUDE.md — Math Tutor Codebase Guide

This file provides context for AI assistants working on this codebase.

---

## Project Overview

**Math Tutor** is an AI-powered math tutoring application. It combines a [tldraw](https://tldraw.dev) whiteboard with streaming AI chat.

It has **two session modes**, and the distinction drives much of the codebase:

| Mode | `sessionType` | AI behavior |
|---|---|---|
| **Problem** (default) | `'problem'` | Answers what was asked (a hint, a check, feedback); holds back the answer unless the learner clearly asks for it. |
| **Notes** | `'note'` | Study mode. Explains concepts **directly**, including answers. |

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Canvas:** tldraw 5 (pinned together with `@tldraw/assets`)
- **Styling:** Tailwind CSS 4
- **AI Providers:** Anthropic Claude, OpenAI, Google Gemini, Groq, Ollama (local), and the student's own ChatGPT plan via Sign in with ChatGPT
- **Persistence:** IndexedDB (sessions, Shelf PDFs, backup settings), localStorage (model config); backups as a ZIP download or to a chosen folder
- **PDFs:** PDF.js (`pdfjs-dist`, legacy build) for the Shelf

---

## Repository Structure

```
src/
├── app/
│   ├── api/tutor/route.ts     # Streaming API endpoint (Anthropic + OpenAI-compat + ChatGPT plan)
│   ├── api/chatgpt/route.ts   # Sign in with ChatGPT: status, sign-in, sign-out
│   ├── api/transcribe/route.ts# One image read by the ChatGPT plan (used by the handwriting test)
│   ├── page.tsx               # Home: Continue, every problem and note, what's on the Shelf
│   ├── board/page.tsx         # A free board (renders AppShell; ?new=problem|note starts one)
│   ├── shelf/page.tsx         # The Shelf: what you work from (PDFs of any kind)
│   ├── shelf/read/page.tsx    # One Shelf PDF beside the open exercise's board (?doc=<id>&open=<exercise id>)
│   ├── memory/page.tsx        # Tutor memory: About you, topic self-ratings and the tutor's notes, sent with every question
│   ├── pen-test/page.tsx      # Bare canvas (no tldraw) for judging pen latency on a device, e.g. the BOOX
│   ├── layout.tsx             # Root layout (metadata, fonts)
│   └── globals.css            # Global Tailwind styles
├── components/
│   ├── layout/
│   │   ├── AppBar.tsx         # The bar on every page: Home, Shelf, + New, Settings, and Back up / Backup paused when needed
│   │   ├── AppShell.tsx       # The free board page; wires contexts + UI
│   │   ├── TopBar.tsx         # AppBar on a free board, plus save status
│   │   ├── BoardFrame.tsx     # The layout every board shares: source, board with header and toolbar, tutor drawer
│   │   ├── BottomToolbar.tsx  # Full screen, Hide tools, TeX write-up, Save as (PNG/PDF), Clear, Mark solved, Tutor, Ask tutor (drawing tools are tldraw's own)
│   │   ├── BackupSettings.tsx # Settings' Backup tab: folder backup, download, restore, storage status
│   │   └── SettingsModal.tsx  # Settings: Tutor tab (model/provider, defines PRESETS array) and Backup tab
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Client-only wrapper around TldrawCanvas; defines DrawingCanvasHandle
│   │   ├── TldrawCanvas.tsx   # tldraw editor: loads documents, mirrors them to CanvasContext, exports images
│   │   ├── ProblemStatement.tsx   # Textarea + problem-image capture (problem mode)
│   │   ├── NoteHeader.tsx     # Topic input (notes mode) — replaces ProblemStatement
│   ├── WriteUpPanel.tsx   # TeX write-up dialog: write up the board, LaTeX editor, KaTeX preview, Download .tex
│   │   └── CheckInHeader.tsx  # A check-in board's source: its topics and how it works
│   ├── chat/
│   │   ├── ChatPanel.tsx      # Chat display and scroll container
│   │   ├── ChatMessage.tsx    # Individual message bubble
│   │   └── ChatInput.tsx      # Follow-up message input
│   ├── memory/
│   │   └── TutorMemory.tsx    # /memory: About you, topic ratings by area, own topics, "What the tutor reads"
│   ├── home/
│   │   └── Home.tsx           # Home page: Continue card, every board and Shelf exercise (thumbnails, search, filter, sort, rename), Shelf row
│   ├── pentest/
│   │   └── PenTest.tsx        # /pen-test: draws straight to a canvas, reports samples/s, event delay, longest gap
│   ├── shelf/
│   │   ├── Shelf.tsx          # Shelf grid: add PDFs, Single problem (image/PDF straight onto a new board), remove
│   │   ├── ShelfReader.tsx    # Page viewer (turns, go to page, Contents, trim, full screen) + mark exercises + the open exercise's board and tutor
│   │   └── PdfPage.tsx        # One page (margins trimmed) fit to width, marks drawn over it, drag to mark, taps/swipes turn it
│   └── common/
│       ├── BlobImage.tsx      # Shows a Blob (thumbnail, cover) via an object URL
│       ├── Icons.tsx          # Line icons (kinds, Shelf, tutor, nav) and the solved check
│       └── MoreMenu.tsx       # The "⋯" menu that holds Rename, Delete and Remove
├── context/
│   ├── CanvasContext.tsx      # Mirror of the tldraw document + pending load requests
│   └── SessionContext.tsx     # Session state (problem, chat history, sessionType, sessions)
├── hooks/
│   ├── useSpeechRecognition.ts# Web Speech API wrapper with error recovery
│   ├── useTutorChat.ts        # Sends requests to /api/tutor, handles SSE stream
│   ├── useWriteUp.ts          # The board's TeX write-up: streams it from /api/tutor (writeUp: true)
│   ├── useSessionAutosave.ts  # Main-page autosave, reload restore, New/Load switching
│   ├── useLearnerProfile.ts   # Loads the tutor memory and saves it shortly after each change
│   ├── useBackupStatus.ts     # Shared folder-backup state (starts the backup on first use)
│   └── useChatGPTConnection.ts# Sign in with ChatGPT state for SettingsModal
├── lib/
│   ├── db.ts                  # IndexedDB CRUD for sessions via `idb`
│   ├── history.ts             # Turns saved sessions into Home's entries; search, filter and sort
│   ├── currentBoard.ts        # Which free board /board opens (`math-tutor:currentSession`)
│   ├── pdf.ts                 # PDF.js loading (offline, from public/pdfjs), page render, crops, covers, the book's printed area
│   ├── reader.ts              # Pure reader helpers: margin trim box, page fractions ↔ shown part, printed page numbers
│   ├── shelf.ts               # Shelf actions: add PDF, mark/unmark exercises, single problem from a file
│   ├── checkIn.ts             # Skill check-in: which topics to offer, starting a check-in board
│   ├── learnerProfile.ts      # Tutor memory: topic catalog, ratings, tutor notes (noteTopic, splitTutorNotes), profileForTutor
│   ├── backup.ts              # Backup file: build (backup.json + pdfs/), ZIP download, restore from ZIP/folder/JSON
│   ├── autoBackup.ts          # Folder backup (File System Access), persistent storage, the Back up reminder
│   ├── zip.ts                 # Minimal stored (uncompressed) ZIP writer and reader
│   ├── exportBoard.ts         # Save a board as PNG, or a one-page PDF written around a JPEG
│   ├── texWriteUp.ts          # TeX write-up: the .tex document, cleaning the reply, blocks/inline for the preview
│   ├── modelConfig.ts         # localStorage get/set for ModelConfig
│   ├── chatgpt.ts             # Server-only Sign in with ChatGPT client + OS-keychain token encryption
│   ├── siwc/                  # Vendored OpenAI Sign in with ChatGPT SDK (noncommercial license, see below)
│   ├── constants.ts           # App-wide constants (ChatGPT usage URL, default plan model, RATE_LIMIT_MS)
│   ├── tutorRequestGate.ts    # Server-side five-second / one-at-a-time tutor request gate
│   ├── geminiFallback.ts      # Gemini Flash quota fallback chain
│   ├── tutorContent.ts        # Splits tutor replies into text and LaTeX for KaTeX rendering
│   ├── tutorAsk.ts            # Ask tutor's choices (Hint, Check my work, Feedback, Ask…; notes: Explain this, Check my notes) and the question each sends
│   └── legacyStrokes.ts       # Converts pre-tldraw saved strokes into tldraw draw shapes
└── types/
    ├── index.ts               # All shared TypeScript types
    └── speech-recognition.d.ts# Web Speech API type declarations
android/                       # The Android app (Capacitor 8): a WebView serving the bundled app from out/
capacitor.config.ts            # App id, webDir `out`, androidScheme `http`
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
- Modals are conditionally rendered by the component that opens them (Settings lives in `AppBar`); control their visibility with boolean state there or in a context.
- Anything reading `localStorage` must do so in an effect, not in `useState` initializers — that causes hydration mismatches. `SettingsModal` follows this.

### Styling
- Use Tailwind CSS utility classes only. No CSS modules, no `styled-components`.
- No dark mode is implemented. Do not add one without explicit request.
- Buttons follow a consistent pattern: base classes + hover/disabled variants. Match existing button styles.

### Canvas
- The canvas is **tldraw**, mounted by `TldrawCanvas.tsx` through `DrawingCanvas.tsx`, which loads it with `next/dynamic` and `ssr: false`. `DrawingCanvas` fills its nearest positioned ancestor, so the wrapper in `AppShell` / `ShelfReader` must be `relative` with a size. Its wrapper is `isolate`d so tldraw's own z-indexes (up to 10000) stay under the app's dialogs.
- `DrawingCanvasHandle` (pass a ref as `handleRef`): `captureImage()` exports the selected shapes, else every shape, trimmed to their bounds (PNG, pixelRatio 2 but at most 2048px on the longer side, since a board written zoomed out is thousands of units wide and ChatGPT rejected 6000px images; base64 without the `data:` prefix; `''` when empty); `captureThumbnail()`, `exportImage(format)` (the whole board for **Save as…**, at most 6000px a side), `placeProblemImage(base64)`, `getDocument()`, `getRevision()` (bumped synchronously on every document change), and `clear()` (one undoable step).
- Every board starts with the pen at size **S** (`DEFAULT_PEN_SIZE` in `TldrawCanvas.tsx`); tldraw's default M is too heavy for writing math.
- tldraw's UI supplies the tools, colors, undo/redo and their shortcuts. `MainMenu`, `PageMenu`, `HelpMenu` and debug panels are hidden and there is one page per session.
- `CanvasContext.document` is a **debounced** (250ms) copy of the editor's document. When saving, read `getDocument()` from the handle (both `AppShell` and `ShelfReader` do), or the last stroke can be missed.
- Loading: dispatch `LOAD` with `document` (tldraw format) and/or `strokes` (pre-tldraw format). The editor applies it when mounted, clears undo history, then dispatches `LOADED`. Until then `pendingLoad` holds the strokes, and saves keep them so an unconverted old session is never overwritten with an empty board.
- Old sessions: `legacyStrokes.ts` turns strokes into draw shapes. The old canvas erased with `destination-out`, so pen ink under a *later* eraser stroke's swept path (its segments, not just its sampled points) is dropped.
- **Assets:** fonts, icons and translations are copied from `@tldraw/assets` into `public/tldraw-assets` (gitignored) by the `postinstall` script, so nothing loads from tldraw's CDN. Keep `tldraw` and `@tldraw/assets` on the same exact version.
- **License:** with no license key tldraw runs on `http://localhost` / `127.0.0.1` (any http origin counts as development) and shows a small "Get a license for production" note. A hosted deployment needs a key from tldraw.dev.

### Shelf
- PDFs live in the IndexedDB store `shelf` (db version 2) as `ShelfDocument`s: the file Blob, a cover, the last page read, and the marked `exercises` (`page` plus a `rect` in fractions of the page).
- Marking an exercise crops that region to a PNG (`cropPage`) and creates its board, the session `shelf:<document id>:<exercise id>`, with the crop as `problemImage` (so the tutor gets it as the problem figure) and `exerciseStatement` as the problem text. Home lists these once they hold work and opens them at `/shelf/read?doc=…&open=…`.
- **Book pages for the tutor** (`src/lib/bookContext.ts`): with every question on a Shelf board, the reader sends the text of the pages leading up to the exercise as `bookContext`. They run from the last PDF bookmark at or before the exercise's page (skipping "Exercises"/"Answers" bookmarks), or the 6 pages before it without bookmarks, to the exercise's page; never past it (answer keys sit later), at most `MAX_BOOK_PAGES` (15). The student can change the start or turn it off on the board (`ShelfExercise.readFrom`, 0 = off), and later exercises in the same section reuse that choice. Scans with no text layer send nothing.
- **Put on board** (Shelf board header; main page beside the captured problem) places `problemImage` on the canvas as a locked image shape (`meta.problemImage`, once per board; Clear leaves it). The tutor then sees it twice: as `problemImage` and inside the board export, which is what lets it read work written on the figure.
- **Reading** (design: https://claude.ai/artifact/TXw8zCKZbwQ9ohM2Fk9nC8, built step by step): a tap in a page's outer quarter, a sideways swipe or ←/→ (no board open) turns it; the overlay is `touch-pan-y` so up-and-down drags still scroll. Page numbers are the PDF's own labels when it has them (`getPageLabels`; "p. 47 (59 of 312)"), and tapping it goes to a page by label or by place in the file (`findPage`). The list beside the page has **Exercises** and **Contents** tabs; Contents is the PDF's bookmarks (`loadContents`, nested, with the current section marked).
- **Trim margins** (on unless `ShelfDocument.trimMargins === false`): `trimmedArea` measures the printed area of up to 8 pages once per open PDF and `bookCrop` takes their union, padded, never trimming more than 18% a side, so pages keep one shape. Marks stay in fractions of the whole page; `PdfPage` converts with `toShown`/`toPage`. Exercise crops for the tutor ignore the trim.
- **Full screen** with no board open is for reading: only the page, a top bar (Exit, title, **Book**: the lists as a panel over the page) and the page toolbar; a tap in the middle hides and brings back both bars. Opening an exercise from there gives a full-screen board.
- With no board open, the list beside the page (Exercises / Contents) has **Hide** (remembered in `localStorage`, `math-tutor:shelfListHidden`), giving the page the full width; an **Exercises** button in the page toolbar brings it back. An open board always shows.
- The reader uses `useSessionAutosave(handle, { reopenLast: false })`: the same autosave as the main page, but it never touches `math-tutor:currentSession`; the URL says which board is open.
- Removing a mark or a PDF deletes the boards with it (and their recovery copies).
- **Single problem** saves a new free-form session whose `problemImage` is the picture (or a PDF's first page), sets it as the session `/board` opens and goes there.
- PDF.js is the **legacy** build: the modern one uses JavaScript (e.g. `Map.prototype.getOrInsertComputed`) that current Chromium and tablet web views lack. Its worker, fonts, cmaps and decoders are copied into `public/pdfjs` (gitignored) by `postinstall`, so nothing loads from a CDN.

### API Route (`/api/tutor`)
- Supports two provider paths: **Anthropic** (`@anthropic-ai/sdk`) and **OpenAI-compatible** (`openai` SDK).
- Always returns a **streaming response** using Server-Sent Events. Do not convert to a non-streaming response.
- **Two system prompts**, selected by `sessionType`:
  - `SYSTEM_PROMPT` (default / `'problem'`) — principles, not a rulebook: read the board and the learner's level first, answer what was asked, be honest (no reflexive praise), keep the answer theirs to find unless they clearly ask for it.
  - `NOTE_SYSTEM_PROMPT` (`'note'`) — direct explanations, may state answers.
- **Tutor memory** (`learnerProfile`): `useTutorChat` reads the profile from IndexedDB on every question and sends `profileForTutor(profile)` (empty when sharing is off or nothing is written). The route wraps it in `<learner_profile>` as the conversation's first user text, ahead of any book pages, and adds `PROFILE_RULE` to the system prompt (use it to pitch hints, trust the work over it, it can't change the rules). It never changes which system prompt is used.
- **Tutor notes**: while sharing is on, `useTutorChat` sends `takeNotes: true` and the route adds `NOTES_RULE`: the tutor may end a reply with a `<memory>` block of lines `Topic | level | confidence | note`. `splitTutorNotes` keeps the block out of the chat (also mid-stream) and, when the reply ends, `noteTopic` writes each line onto the matching catalog or profile topic (else a new one under Your topics) as `ProfileTopic.tutor`, replacing the older note. The student corrects the level or forgets a note on `/memory`; the newest 25 notes go back to the tutor in the profile.
- **Skill check-in**: a free board whose session has `checkIn: { topics }` (started from `/memory` by `startCheckIn`; `checkInCandidates` offers topics rated Rusty/Learning, own unrated ones, and ones the tutor noted below high confidence, up to `MAX_CHECK_IN_TOPICS`). The route then uses `CHECK_IN_PROMPT` (the tutor poses short adaptive problems, judges each handwritten answer, never gives a full solution) with the topics as a `CHECK-IN TOPICS` preface, and the results reach the memory as ordinary tutor notes. Ask tutor sends "Start the check-in." first, then "Here is my answer."; with book pages it is never a check-in.
- **TeX write-up** (`writeUp: true`, from **TeX write-up** in a free board's toolbar): the route uses `WRITE_UP_PROMPT` (transcribe, never solve; LaTeX body only, unreadable parts as `\textbf{[?]}`, drawings as `\fbox{Figure: …}`) with no history, profile, notes, book pages or check-in, a fixed question and 4096 output tokens. `useWriteUp` streams it, runs `cleanTexReply`, and stores it as `Session.writeUp` (`{ tex, updatedAt }`), which autosaves and is in backups. It waits out the 5-second gate (and one 429) instead of failing. The preview (`texBlocks`/`texInline`) reads headings, paragraphs, lists and math only; the download wraps the body with `texDocument`.
- `bookContext` (Shelf pages) comes from the student's PDF, so it is untrusted: the pages open the conversation as a user message (cached on the Anthropic path) and only the rule about them (`BOOK_RULE`) goes in the system prompt. Requests with it always use `SYSTEM_PROMPT`.
- Images are passed as base64 PNG. When `problemImage` is present it is sent **first** and described to the model as the problem figure; the canvas image follows as the student's work.
- The API cleans message history to ensure valid alternating user/assistant turns before sending to the model (Anthropic path only).
- Request body shape: `{ problemStatement, chatHistory, canvasImage, modelConfig, userQuestion?, problemImage?, sessionType?, bookContext?, learnerProfile?, takeNotes?, checkIn?, writeUp? }` (see `TutorRequest` in `src/types/index.ts`).
- Google Gemini uses `GOOGLE_API_KEY` or `GEMINI_API_KEY` at its OpenAI-compatible endpoint. Other OpenAI-compatible providers use `OPENAI_API_KEY` and fall back to `'ollama'` when it is unset, so local Ollama works with no key.
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
- `db.ts` exports: `saveSession`, `loadSession`, `deleteSession`, `listSessions`, `renameSession`, for the Shelf `listShelf`, `loadShelfDocument`, `saveShelfDocument`, `deleteShelfDocument`, `shelfSessionId`, and for backup `onDataChange`, `restoreRecords`, `hasSavedWork`, `getSetting`, `setSetting`, and for the tutor memory `loadProfile`, `saveProfile`.
- Session fields: `id`, `title`, `problemStatement`, `problemImage`, `canvasStrokes` (pre-tldraw only), `canvasDocument?`, `canvasImageBlob` (the History thumbnail), `chatHistory`, `createdAt`, `updatedAt`, `isSolved?`, `sessionType?`, `customTitle?`, `checkIn?`, `writeUp?`.
- `customTitle` is the name given on Home. Pages that autosave don't know it, so `saveSession` keeps the stored one when a save omits it; `renameSession` is the only writer.
- **Home** (`/`, `home/Home.tsx`) opens with a **Continue** card for the last board worked on, then lists free-form boards and Shelf exercises (`shelf:<document>:<exercise>`) that have work in them. A Shelf entry opens beside its page; a free board is set as the one `/board` opens (`setBoardToOpen`). Filters: All, Problems, Notes, In progress, Solved. Below the list, the Shelf's newest PDFs. Sessions left from the removed built-in workbook (`workbook:…` ids) stay stored and in backups but are not listed.
- **Backup** (Settings → Backup): a backup is `backup.json` (`BackupManifest`: sessions with thumbnails as data URLs, Shelf entries without their file) plus `pdfs/<id>.pdf`. The download is one stored ZIP (`zip.ts`); folder backup writes the same files into `Math Tutor backup/` in the chosen folder, plus `backup-YYYY-MM-DD.json` (last 7 days), 30s after a change (`onDataChange` in `db.ts` fires on every session/Shelf write). Restore (`restoreRecords`) writes a record only when this device has none or an older `updatedAt`. The folder handle and backup state live in the IndexedDB `settings` store (db version 3). Folder backup is Chromium-only; elsewhere (e.g. Android) only download/restore show. If you add a store or a field that holds work, add it to the backup.
- **Tutor memory** (`/memory`, from Settings → Tutor and, while empty, a line on Home): a `LearnerProfile` (`aboutMe`, rated `topics`, `shareWithTutor`, `updatedAt`) in the `settings` store under `learnerProfile` (`loadProfile` / `saveProfile`). Catalog topics (`TOPIC_AREAS`) exist in the profile only while rated or noted by the tutor; topics the student adds stay until removed. Topic ids are `area/name` slugs, so don't rename catalog entries' ids casually. It is in backups (`BackupManifest.profile`; newer `updatedAt` wins on restore).
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
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | For Gemini | Gemini API key |
| `OPENAI_API_KEY` | For other OpenAI-compat providers | OpenAI / Groq key (not needed for Ollama) |
| `CHATGPT_REDIRECT_PORT` | No | Loopback port for the Sign in with ChatGPT callback (default `8791`) |
| `NEXT_PUBLIC_OLLAMA_BASE_URL` | No | Overrides the default Ollama preset URL (`http://localhost:11434/v1`) — useful when Ollama runs on another machine |

The app shows user-friendly error messages for missing/invalid keys.

### Scripts
```bash
npm run dev    # Development server (port 3000; webpack, like build — Turbopack + turbopack.root on Next 16.1.6 resolves Tailwind one folder up)
npm run build  # Production build
npm run build:android  # The app bundled with no server (static export to out/), copied into android/ by `cap sync`
npm run start  # Production server
npm run lint   # ESLint
npm run typecheck  # tsc --noEmit
npm test       # Unit tests
npm run test:e2e   # Browser tests (boards, tutor chat, Shelf, Shelf reading, backup, tutor memory, check-in, TeX write-up, pen test; `npm run test:android:e2e` checks the Android bundle in out/); needs `npm run start -- -p 3100` running
npm run handwriting  # Handwriting test: transcribe tests/handwriting/wacom/<page-id>.png with each model, score against tests/handwriting/pages.json (results in tests/handwriting/results/, gitignored). chatgpt:<model> entries go through the running app's /api/transcribe, so start the app and sign in first
```

### Workflow and CI
- Every change goes through a branch and a PR, whoever makes it (Scott alternates Codex and Claude; Codex reads `AGENTS.md`, which points here). Push before stopping.
- `.github/workflows/ci.yml` runs on every PR and on `main`: `npm ci`, `lint`, `typecheck`, `npm test`, `build`, then `npm run test:e2e` against the production build on port 3100. The browser tests use a mock provider, so CI needs no API keys.
- Review comments are addressed (fixed, or answered with why not) and resolved before merging; `main` requires resolved conversations and a green `check` job.
- The `android` job in the same workflow runs `npm run build:android`, `npm run test:android:e2e` (the bundle served the way the app serves it) and `./gradlew assembleDebug`, and attaches the APK to the run as `math-tutor-android`. The container used for cloud sessions can't download the Android SDK, so the APK is only built there.

### Android app
- **Step 1 of the standalone tablet app** (agreed 2026-10-15: no Mac needed). Later steps: tutor calls from the device with keys stored on it, Sign in with ChatGPT on the device (127.0.0.1 loopback + Android Keystore; personal local use needs no OpenAI waitlist), then BOOX's pen SDK.
- `BUILD_TARGET=android` makes `next.config.ts` export statically and only treat `.tsx` (and `.mdx`) files as pages, which leaves the API routes out. A one-entry `pageExtensions` (`['tsx']`) breaks the webpack build on Next 16.1.6.
- Capacitor answers every extensionless path with `index.html` (Home). So in the Android build the root layout adds a script that sends a full load of `/board` to `/board.html` and puts `/board` back in the address before the app starts. Soft navigation is unaffected.
- `androidScheme: 'http'`: `http://localhost` is still a secure context, and tldraw treats http origins as development (no license key).
- With no server, `/api/tutor` answers with Home's HTML; `useTutorChat` and `useWriteUp` turn a non-SSE reply into `TUTOR_UNAVAILABLE`.
- The WebView can't save `blob:` downloads, so `downloadBlob` (`src/lib/backup.ts`) sends files to the app's own `SaveFile` plugin (`android/app/src/main/java/com/scottmttmn/mathtutor/SaveFilePlugin.java`, registered in `MainActivity`), which opens Android's Save dialog. It resolves `false` when the dialog is cancelled, and then the backup isn't recorded.

### Linting
ESLint uses the Next.js core web vitals config. Run `npm run lint` before committing. There is no Prettier config; formatting follows ESLint rules.

---

## Core Data Flow

### Help Request (primary user flow)
1. User writes the problem in `ProblemStatement` (or a topic in `NoteHeader`), draws on `DrawingCanvas`.
2. Clicks **Ask tutor** (both modes) and picks what they want from its menu (`askChoices` in `src/lib/tutorAsk.ts`): **Hint**, **Check my work**, **Feedback** or **Ask…** (notes: **Explain this**, **Check my notes**, **Ask…**). Each choice sends its question (`askQuestion`) as `userQuestion`; the prompt answers what was asked, so there are no per-choice rules. **Ask…** opens the drawer with the cursor in the chat box (`focusTutorQuestion`), and a question typed there can open the conversation, always with the board. A check-in board's Ask tutor has no menu: it hands in an answer.
3. `AppShell.handleAskForHelp()` calls `canvasHandle.current.captureImage()` → base64 PNG of the selected shapes, or of the whole drawing trimmed to its bounds.
4. `useTutorChat.sendHelp(canvasImage, question)` POSTs to `/api/tutor` with the request body above, including `sessionType`.
5. API selects the system prompt from `sessionType` and streams an SSE response; client appends `text_delta` events to chat in real time via `APPEND_TO_LAST_MESSAGE` dispatch.
6. The session **autosaves** (see below); there is no Save button.

### Follow-up Chat
- `useTutorChat.sendFollowUp(text, canvasImage?)` uses the same `/api/tutor` endpoint. `ChatInput` (on free and Shelf boards) attaches a fresh `captureImage()` only when the handle's `getRevision()` changed since the tutor last saw the board; otherwise the follow-up is text-only. Don't use the debounced `CanvasContext.document` for this: it misses a stroke finished just before sending.

### Session Save/Load
- **Autosave:** `useSessionAutosave` saves 800ms after the last change (problem, image, chat, solved, type, drawing), reading the live document from the handle. It skips an untouched new session and a session that was only opened (it compares content, not timestamps), keeps `createdAt`, and serializes saves. The top bar shows Saving…/Saved, or a Retry button after a failure. New saves write `canvasStrokes: []`.
- **Reload:** the open session's id is kept in `localStorage` (`math-tutor:currentSession`) and reopened on load. On `pagehide`/hidden it stages a synchronous recovery copy via `src/lib/sessionRecovery.ts` (shared with the Shelf reader); a session reopened from that copy is written back to IndexedDB.
- **Open / New:** Home opens a free board by setting it as `/board`'s session; `startNew` saves the current session first, then loads an empty one.
- **New:** **+ New** in `AppBar` (every page) is a dropdown — *New Problem* or *New Notes*. On `/board` it calls `AppShell.handleNew()`; elsewhere it goes to `/board?new=<type>`, which starts the board once and drops the parameter.

### Navigation
- `AppBar` is on every page (hidden in full screen): **Home** and **Shelf** tabs, **+ New**, and a Settings gear. Pass `locked` while a tutor reply streams so links can't leave the page.
- The reader's breadcrumb leads back to the Shelf.
- Design direction (agreed 2026-10-14): boards, the Shelf, and a tutor you call. Later: folders (or similar) for problems and notes, and a new name for the app.

### Visual language
- Ink on paper: grays, black and white. Meaning is carried by icon, shape and word, so every screen still reads in greyscale on an e-ink tablet.
- **Only the tutor has a color**, Tailwind `indigo-700` (`indigo-50` for its replies and tints): **Ask tutor**, the **Tutor** toggle, the drawer's edge and heading, Send/Ask in a chat, "Tutor reads". Nothing else uses indigo, and the tutor uses nothing else. Focus rings and links are ink.
- **Solved** is a filled ink check (`SolvedCheck` in `common/Icons.tsx`) plus the word, everywhere (boards, Home, Shelf lists; the Shelf page's mark gets a filled label). No green.
- Kinds wear their icon (`KindIcon`: Problem, Notes; `ShelfIcon` for the Shelf) on cards, in the board's title line and in **+ New**.
- Controls are at least 44px tall (`min-h-11`) and labelled in words. One solid ink button per screen for its main action. Delete, Rename and Remove live in a `MoreMenu` ("⋯"), with an inline confirm for deletes.
- Red is only for errors and failed saves, always with words.

### Board frame
- Every board (free board, Shelf exercise) renders `BoardFrame`: the **source** it works from (typed problem or topic, PDF page with its page toolbar; `wide` for the page), then the board with a header (title, actions, a **Hide/Show {source}** toggle) and the `BottomToolbar`, then the **tutor**.
- The tutor is a drawer, closed until asked: **Ask tutor** opens it, the toolbar's **Tutor** button toggles it, **Close** in its header shuts it. A new or switched board opens with it closed.
- Below 2xl (96rem) the open tutor takes the source's place (above the board on narrow screens), so the board keeps its room; the header toggle then reads **Show {source}** and closes the tutor. On 2xl screens all three sit side by side.

### Full screen and tools
- **Hide tools** (`BottomToolbar` `tools` prop, `useToolsHidden`, remembered in `localStorage` as `math-tutor:toolsHidden` for every board) passes `hideUi` to tldraw: toolbars and style panel go, the current tool (the pen) keeps working.
- Every board (main page, Shelf) has a **Full screen** button in `BottomToolbar` (`fullScreen` prop), driven by `useBoardFullScreen`: the page hides everything but the board and toolbar and asks the browser for full screen. Esc, Exit full screen, **Tutor** or **Ask tutor** (so the reply is visible) leaves it.

### Keyboard Shortcuts
Registered once in `AppShell` (handlers read latest values through refs):

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+S` | Save now (sessions also autosave) |

Undo, redo, delete and tool keys are tldraw's own. Shortcuts are ignored while focus is in an `input`, `textarea`, or contenteditable element.

### Rate Limiting
- All tutor requests share a **five-second** minimum interval (`RATE_LIMIT_MS`, measured from request start) with no visible countdown, and only one request runs at a time. The old 5-minute cooldown is gone; Scott chose to keep the 5-second one.
- The server enforces it in `src/lib/tutorRequestGate.ts` (429 with `Retry-After`); every provider path must call the gate's `release` when its stream ends. The browser mirrors it in `useRateLimit` (`tryStartTutorRequest`, `getTutorWaitMs`). Click handlers check `getTutorWaitMs()` rather than a component's `isLimited`, which can lag by one timer tick.
- Spending is otherwise bounded by the provider: API-key billing, or the ChatGPT plan's own limits and per-app weekly cap.

---

## AI Provider Configuration

Configured via `SettingsModal` and stored in `localStorage`. Provider presets are defined as the `PRESETS` array inside `SettingsModal.tsx` (not in `constants.ts`):

| Provider | SDK Used | Default Model | Base URL |
|---|---|---|---|
| Anthropic (Claude) | `@anthropic-ai/sdk` | `claude-sonnet-5-5` | Default (api.anthropic.com) |
| ChatGPT plan | vendored `src/lib/siwc` | First listed model matching `CHATGPT_DEFAULT_MODEL_PATTERN` (Sol; Luna invented content in the handwriting test), else the first listed | `https://api.openai.com/v1/responses` (fixed) |
| OpenAI | `openai` (compat) | `gpt-4o` | `https://api.openai.com/v1` |
| Google Gemini | `openai` (compat) | `gemini-3.8-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Groq | `openai` (compat) | `llama-3.3-70b-versatile` | `https://api.groq.com/openai/v1` |
| Ollama | `openai` (compat) | `llama3.2-vision` | `NEXT_PUBLIC_OLLAMA_BASE_URL` ?? `http://localhost:11434/v1` |
| Custom | `openai` (compat) | User-specified | User-specified |

The Base URL field is editable for **every** OpenAI-compatible provider (not just Custom), so a remote Ollama or a proxy can be pointed at without picking Custom.

Default model config (when nothing is saved in localStorage): `anthropic` / `claude-sonnet-5-5`.

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
4. Pass it through `snapshot` / `applyLoad` in `src/hooks/useSessionAutosave.ts` (and add it to `contentKey` if editing it should trigger a save).
5. Make it optional (`field?:`) so previously saved sessions still load.

---

## Important Constraints

- **`SYSTEM_PROMPT` is written as principles, not rules** (Scott, 2026-10-16): the tutor serves the learner's long-term growth over how they feel in the moment, and holds back the answer unless they clearly ask for it. Don't turn it back into a checklist (hint ladders, sentence caps, scripted praise); give the model better information instead. The hard lines stay elsewhere: never solutions from the book's pages (`BOOK_RULE`) or during a check-in (`CHECK_IN_PROMPT`). `NOTE_SYSTEM_PROMPT` is *intentionally* direct, and the two prompts must stay distinct.
- **Do not break streaming.** The API must remain SSE-based. Don't convert to JSON responses.
- **Keep tldraw as the single source of truth for the drawing.** Don't add a parallel stroke store; mirror what you need through `CanvasContext`.
- **Do not add dark mode** unless explicitly requested.
- **Do not introduce new state management libraries.** Use React Context + useReducer.
</content>
