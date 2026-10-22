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
│   ├── api/tutor/route.ts     # Streaming API endpoint: server keys, request gate, ChatGPT plan (prompts and providers are in lib)
│   ├── api/chatgpt/route.ts   # Sign in with ChatGPT: status, sign-in, sign-out
│   ├── api/transcribe/route.ts# One image read by the ChatGPT plan (used by the handwriting test)
│   ├── page.tsx               # Home, the library's top level: Continue, folders, books outside folders, free boards
│   ├── board/page.tsx         # A free board (renders AppShell; ?new=problem|note starts one)
│   ├── folder/page.tsx        # One folder (?id=<id>): Home's library for what is inside it
│   ├── book/page.tsx          # Old book page address (?doc=<id>): sends to the book's folder, or the reader
│   ├── shelf/page.tsx         # Old Shelf address: sends to Home
│   ├── shelf/read/page.tsx    # One Shelf PDF beside the open exercise's board (?doc=<id>&open=<exercise id>)
│   ├── memory/page.tsx        # Tutor memory: About you, topic self-ratings and the tutor's notes, sent with every question
│   ├── pen-test/page.tsx      # Bare canvas (no tldraw) for judging pen latency on a device, e.g. the BOOX
│   ├── layout.tsx             # Root layout (metadata, fonts)
│   └── globals.css            # Global Tailwind styles
├── components/
│   ├── layout/
│   │   ├── AppBar.tsx         # The bar on every page: Home, + New (problem, Problem from tutor, notes, Add a PDF, New folder), Settings, and Back up / Backup paused when needed
│   │   ├── TutorProblemDialog.tsx # + New → Problem from tutor: topic (from the tutor memory), like a favorite, anything else
│   │   ├── AppShell.tsx       # The free board page; wires contexts + UI
│   │   ├── TopBar.tsx         # AppBar on a free board, plus save status
│   │   ├── BoardFrame.tsx     # The layout every board shares: source, board with header and toolbar, tutor drawer
│   │   ├── BottomToolbar.tsx  # Full screen, Paper swatches, sweep Clear, Board menu (tools, TeX write-up, PNG/PDF, Pen test), Favorite, Mark solved, one Ask tutor toggle (direct Start check-in / Hand in answer on check-ins) (drawing tools are tldraw's own)
│   │   ├── FavoriteButton.tsx # Favorite: the star and its optional "What made it good?"
│   │   ├── BackupSettings.tsx # Settings' Backup tab: folder backup, download, restore, storage status
│   │   └── SettingsModal.tsx  # Settings: Tutor tab (model/provider, defines PRESETS array) and Backup tab
│   ├── workspace/
│   │   ├── DrawingCanvas.tsx  # Client-only wrapper around TldrawCanvas; defines DrawingCanvasHandle
│   │   ├── TldrawCanvas.tsx   # tldraw editor: loads documents, mirrors them to CanvasContext, exports images
│   │   ├── InkBoard.tsx       # The ink board (opt-in, replacing tldraw): page, tools, input, the same DrawingCanvasHandle
│   │   ├── ProblemStatement.tsx   # Textarea + problem figure: Add picture (image or PDF) or Capture as Problem (problem mode)
│   │   ├── NoteHeader.tsx     # Topic input (notes mode) — replaces ProblemStatement
│   │   ├── TutorProblemHeader.tsx # A problem the tutor wrote: typeset, not editable, Different problem while the board is empty
│   ├── WriteUpPanel.tsx   # TeX write-up dialog: write up the board, LaTeX editor, KaTeX preview, Download .tex
│   │   └── CheckInHeader.tsx  # A check-in board's source: its topics and how it works
│   ├── chat/
│   │   ├── ChatPanel.tsx      # Chat display and scroll container
│   │   ├── ChatMessage.tsx    # Individual message bubble
│   │   ├── UsageFooter.tsx    # A request's tokens (input, output, reasoning, cached), under a reply or a tutor-written problem
│   │   └── ChatInput.tsx      # Follow-up message input
│   ├── memory/
│   │   └── TutorMemory.tsx    # /memory: About you, topic ratings by area, own topics, the tutor's notebook, favorites, "What the tutor reads"
│   ├── home/
│   │   ├── Home.tsx           # The library, on Home and each folder's page: Continue (Home), the folder's books, folders and boards; search/filter reach inside; Move to; drop a PDF to add it
│   │   ├── BoardCard.tsx      # A board in a list (thumbnail, kind, book, solved, favorite; Rename, Move to and Delete)
│   │   ├── FolderCard.tsx     # A folder in a list (a book's cover or the folder icon, what it holds; Rename, Move to, Delete)
│   │   └── MoveDialog.tsx     # Move to…: the top level and every folder, indented
│   ├── book/
│   │   └── BookHero.tsx       # A text at the head of its folder: Read at p. N, progress; Move to, Remove
│   ├── pentest/
│   │   └── PenTest.tsx        # /pen-test: draws straight to a canvas, reports samples/s, event delay, longest gap
│   ├── shelf/
│   │   ├── BookCard.tsx       # A text's card outside a folder (BookCover: cover, solved, where you left off; Move to, Remove), readerHref
│   │   ├── ShelfReader.tsx    # Page viewer (turns, go to page, Contents, trim, full screen) + mark exercises and note pages + the open one's board and tutor
│   │   ├── PageAsk.tsx        # Ask about the page: the tutor on a boxed region, kept only if saved as a note page
│   │   ├── BookSearch.tsx     # Search: matches by section and page, with a line around each
│   │   ├── BookList.tsx       # Your list: the book's exercises, note pages, highlights (quoted) and ink by section, with solved counts
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
│   ├── useBookSearch.ts       # Searches the open PDF page by page as the student types
│   ├── useWriteUp.ts          # The board's TeX write-up: streams it from /api/tutor (writeUp: true)
│   ├── useTutorProblem.ts     # A board's problem from the tutor: asks for it (makeProblem), Different problem
│   ├── useSessionAutosave.ts  # Main-page autosave, reload restore, New/Load switching
│   ├── useLearnerProfile.ts   # Loads the tutor memory and saves it shortly after each change
│   ├── useFavorite.ts         # The open board's Favorite star, kept in the tutor memory
│   ├── useBackupStatus.ts     # Shared folder-backup state (starts the backup on first use)
│   ├── useBooxPen.ts          # BOOX pen (experiment): Onyx's pen SDK draws the pen tool's strokes, which become tldraw ink
│   ├── useBooxBoard.ts        # BOOX boards: immediate camera moves and fast panel updates during interaction
│   ├── useBooxInk.ts          # The ink board on BOOX: Onyx's pen draws the pen tool, strokes/erasing handed over, fast mode, refresh
│   ├── useDeviceToggle.ts     # deviceToggle(key): an on/off choice remembered per device (Notebook mode, BOOX pen, ink board)
│   ├── useInkBoardMode.ts     # Board → Ink board for new boards (experiment), `math-tutor:inkBoard`
│   ├── useAddPdfs.ts          # Adds PDFs to the library (AppBar's Add a PDF, a drop on Home)
│   └── useChatGPTConnection.ts# Sign in with ChatGPT state for SettingsModal
├── lib/
│   ├── db.ts                  # IndexedDB CRUD for sessions via `idb`
│   ├── history.ts             # Turns saved sessions into Home's entries; search, filter and sort; libraryView (a folder's folders, books, boards), folderSummaries
│   ├── folders.ts             # Reading the folders: folderIndex, where a book or board is (itemFolder), folderPath, folderTree, folderSummary, folderHref
│   ├── folderActions.ts       # Making, renaming, moving and deleting folders; moving boards and books
│   ├── currentBoard.ts        # Which free board /board opens (`math-tutor:currentSession`)
│   ├── pdf.ts                 # PDF.js loading (offline, from public/pdfjs), page render, crops, covers, the book's printed area
│   ├── reader.ts              # Pure reader helpers: margin trim box, page fractions ↔ shown part, printed page numbers
│   ├── ink.ts                 # Ink on Shelf pages: stroke widths and colors, drawing, the stroke eraser
│   ├── bookSearch.ts          # Search a page's text boxes: matches, their rects, a line of context
│   ├── bookList.ts            # Your list's sections (sectionAt) and rows; the words under a highlight (textUnder, pageTextBoxes)
│   ├── paper.ts               # Board paper (blank, lined, grid): the default per kind and where the lines fall
│   ├── shelf.ts               # Shelf actions: add PDF, mark/unmark exercises and note pages, problemImageFromFile
│   ├── checkIn.ts             # Skill check-in: which topics to offer, starting a check-in board
│   ├── tutorProblem.ts        # Problem from tutor: the form's topic and favorite choices, parseMadeProblem (title + problem)
│   ├── tutorText.ts           # requestTutorText: one tutor reply as text (write-up, problem), waiting out the gate
│   ├── learnerProfile.ts      # Tutor memory: topic catalog, ratings, tutor notes (noteTopic, splitTutorNotes), profileForTutor
│   ├── backup.ts              # Backup file: build (backup.json + boards/ + pdfs/), ZIP download, restore from ZIP/folder/JSON
│   ├── autoBackup.ts          # Folder backup (File System Access), persistent storage, the Back up reminder
│   ├── zip.ts                 # Minimal stored (uncompressed) ZIP writer and reader
│   ├── exportBoard.ts         # Save a board as PNG, or a one-page PDF written around a JPEG
│   ├── texWriteUp.ts          # TeX write-up: the .tex document, cleaning the reply, blocks/inline for the preview
│   ├── modelConfig.ts         # localStorage get/set for ModelConfig
│   ├── chatgpt.ts             # Server-only Sign in with ChatGPT client + OS-keychain token encryption
│   ├── chatgptPlan.ts         # ChatGPT plan for server and tablet: Settings' status/actions, the tutor's reply stream
│   ├── chatgptDevice.ts       # Android app: the Sign in with ChatGPT client on the tablet (loopback plugin, DeviceKeys, CapacitorHttp)
│   ├── chatgptConnection.ts   # Settings' ChatGPT calls: /api/chatgpt, or in the Android build chatgptDevice.ts
│   ├── siwc/                  # Vendored OpenAI Sign in with ChatGPT SDK (noncommercial license, see below)
│   ├── constants.ts           # App-wide constants (ChatGPT usage URL, default plan model, RATE_LIMIT_MS, tablet build link)
│   ├── appUpdate.ts           # Android app: the newest published build (release notes' Build: N) and installing it (AppUpdate plugin)
│   ├── tutorPrompt.ts         # The tutor's prompts and planTutorRequest (system prompt, preface, latest turn), shared by the route and the Android app
│   ├── tutorProviders.ts      # Anthropic and OpenAI-compatible streams as the tutor's SSE events (server or, in the Android app, the WebView)
│   ├── tutorRequest.ts        # requestTutor: POST /api/tutor, or in the Android build tutorDirect.ts
│   ├── tutorDirect.ts         # Android app: calls the provider from the tablet with the key saved on it
│   ├── deviceKeys.ts          # Android app: API keys kept by the native DeviceKeys plugin
│   ├── booxPen.ts             # Android app on BOOX: the BooxPen plugin (Onyx's pen SDK), its stroke points and boxes
│   ├── tutorRequestGate.ts    # Server-side five-second / one-at-a-time tutor request gate
│   ├── geminiFallback.ts      # Gemini Flash quota fallback chain
│   ├── tutorContent.ts        # Splits tutor replies into text and LaTeX for KaTeX rendering
│   ├── boardProblems.ts       # A board holding several Shelf exercises: which board a mark is on, picture tags, solved, removing one
│   ├── tutorAsk.ts            # The drawer's choices (Hint, Check my work, Feedback; notes: Explain this, Check my notes) and the question each sends
│   ├── legacyStrokes.ts       # Converts pre-tldraw saved strokes into tldraw draw shapes
│   └── inkBoard/              # The ink board replacing tldraw: model (BoardInk, widths, page), edits + undo, hitTest (grid index, eraser, lasso), render (strokes), camera (fit width, zoom, clamping), capture (tutor/thumbnail/export pictures), fromTldraw (converter)
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
- `DrawingCanvasHandle` (pass a ref as `handleRef`): `captureImage()` exports the selected shapes, else every shape, trimmed to their bounds (PNG, pixelRatio 2 but at most 2048px on the longer side, since a board written zoomed out is thousands of units wide and ChatGPT rejected 6000px images; base64 without the `data:` prefix; `''` when empty); `captureForTutor()` adds overlapping 2x close-ups of non-problem shapes when that overview would be downscaled (all selected shapes still appear in the crops, including problem pictures behind annotations; empty tiles are skipped; at most 12 close-ups, otherwise ask for a selection); `captureThumbnail()`, `exportImage(format)` (the whole board for **Save as…**, at most 6000px a side), `placeProblemImage(base64, key?)`, `getDocument()`, `getRevision()` (bumped synchronously on every document change; selection is not a document change), and `clear()` (one undoable step).
- Every board starts with the pen at size **S** and dash **solid** (`DEFAULT_PEN_SIZE`, `DEFAULT_PEN_DASH` in `TldrawCanvas.tsx`); tldraw's default M is too heavy for writing math, and its default "draw" dash makes uneven ink.
- The style panel is collapsed by default behind a 44px **Pen: color, size** chip at the canvas's top right (`PenStylePanel`). Tap to open tldraw's native controls; changing styles leaves it open, a pen stroke or Esc closes it. The chip follows selected shapes' shared styles (or shows Mixed). Open/collapsed is read after mount and remembered per device in `localStorage` as `math-tutor:stylePanelOpen`. It uses the otherwise unused `SharePanel` slot, with `StylePanel: null`, so it stays at the top right even below tldraw's 640px mobile breakpoint. `hideUi` hides the chip too. The native palette/opacity remain until the BOOX pen test informs a smaller greyscale palette.
- **Paper** (toolbar: Blank, Lined, Grid; `Session.paper`, unset until chosen, `paperFor` gives lined for notes and blank for problems) is tldraw's `Background` component drawing lines that follow the camera. It is only a background: exports and what the tutor sees are the writing alone, and nothing snaps to it (tldraw's grid mode would).
- **Notebook mode (experiment)** in the Board menu is opt-in and remembered per device (`math-tutor:notebookMode`, `useNotebookMode`, storage read after mount) for free and Shelf boards. `useNotebookCamera` gives new boards a 960-unit paper width with 16px screen gutters and a top edge: the camera stays within the page's sides and can't scroll above its top (a gray desk shows above it), and scrolls down without end. Zoom remains available; **Fit width** returns to writing scale at the current vertical position and stays available with tools hidden. At writing scale, layout/full-screen/orientation width changes refit; an intentional close-up keeps its zoom. Constraints suspend while a Shelf board is hidden to avoid zero/NaN camera coordinates, then restore its view. Existing work outside that width (or above y 0) gets a wider page (or a higher top) on entry/load; pasted or moved ink beyond the edges or above the top also expands it after the edit rests. Ink is never moved, clipped or rescaled. It is view state, not a document migration: turn it off to return to the infinite canvas. Paper edges are background only; tutor captures, selections and exports keep their existing behavior. Problem pictures fit the notebook width and navigate to the picture without zooming out to fit the whole long board.
- Loading an empty board deletes the last board's shapes with `ignoreShapeLock`, or its locked problem picture would stay behind.
- tldraw's UI supplies the tools, colors, undo/redo and their shortcuts. `MainMenu`, `PageMenu`, `HelpMenu` and debug panels are hidden and there is one page per session.
- `CanvasContext.document` is a **debounced** (250ms) copy of the editor's document. When saving, read `getDocument()` from the handle (both `AppShell` and `ShelfReader` do), or the last stroke can be missed.
- `captureThumbnail()` makes a library-card PNG at most 512 pixels on its longer side, with fixed padding. Fixed padding avoids tldraw's automatic pixel-readback trim; keep full-board raster work out of autosave. Tutor captures and explicit exports use their own larger limits.
- BOOX's native preview width follows the current pen size and camera zoom (or stays at screen size with tldraw's dynamic resize mode), matching the solid draw path's `(theme.strokeWidth × size factor + 1) × zoom`. Apply it after SDK startup as well as before opening input; a startup-only width correction still let ink thicken at handoff on the Go 10.3, while updating the running pen stayed consistent. `setWidth` changes the live preview without restarting raw input. Keep the size factors aligned with the pinned tldraw renderer; browser tests compare preview width with the actual SVG at writing zoom and after a pinch.
- On BOOX, `useBooxBoard` makes camera moves immediate and calls `BooxPen.interaction` to hold Onyx's transient `ANIMATION` mode while an editing tool (select, eraser, hand, etc.) is chosen. With the pen chosen, finger pans/pinches and wheel input use fast mode until the last contact and camera movement settle for 180 ms. `FastRefreshController` suspends native pen rendering during these gestures without stopping raw input; pen contact takes priority. Returning to the pen, hiding/leaving the board and lifecycle cleanup release fast mode without forcing a repaint. Focus/visibility restores it for an editing tool. Native scheduler/controller tests cover pen priority and cleanup. These adjustments apply whether the native pen experiment is on or off. Suppressing pen hover and the eraser trail felt the same or worse, so the usual feedback is retained. Constant fast mode was clearly better and usable; an intermediate per-gesture `GU` cleanup repaint added distracting flashes and was removed.
- Loading: dispatch `LOAD` with `document` (tldraw format) and/or `strokes` (pre-tldraw format). The editor applies it when mounted, clears undo history, then dispatches `LOADED`. Until then `pendingLoad` holds the strokes, and saves keep them so an unconverted old session is never overwritten with an empty board.
- Old sessions: `legacyStrokes.ts` turns strokes into draw shapes. The old canvas erased with `destination-out`, so pen ink under a *later* eraser stroke's swept path (its segments, not just its sampled points) is dropped.
- **Assets:** fonts, icons and translations are copied from `@tldraw/assets` into `public/tldraw-assets` (gitignored) by the `postinstall` script, so nothing loads from tldraw's CDN. Keep `tldraw` and `@tldraw/assets` on the same exact version.
- **License:** with no license key tldraw runs on `http://localhost` / `127.0.0.1` (any http origin counts as development) and shows a small "Get a license for production" note. A hosted deployment needs a key from tldraw.dev.

### Ink board (replacing tldraw, in progress)
- Agreed 2026-10-21 (plan: https://claude.ai/artifact/WgrS9kXhB83B9ardHWxd1Q): our own Notes-like board, one TypeScript implementation on every device, Onyx's pen engine for the pen and eraser on BOOX, behind the same `DrawingCanvasHandle`. One long fixed-width page, whole-stroke eraser, lasso move/delete/copy, inks black and gray (more colors on the computer). If scrolling/zooming a web canvas fails the BOOX trial, the renderer moves into a native view behind the same data format. Steps: 1 format and engine core (done), 2 opt-in board on the computer (done), 3 BOOX (done; Scott's Go 10.3 trial 2026-10-21: works well, the page-drawn highlighter lagged, so it moved to the SDK), 4 lasso, 5 pictures/tutor/exports, 6 conversion on open and default flip, 7 remove tldraw, 8 additions.
- Data (`BoardInk` in `src/types/index.ts`): `page` (`left`, `top`, `width`; grows to fit work, never moves it), `strokes` in drawing order (`tool`, `color` from `INK_COLORS`, `width` at medium pressure, flat `[x, y, pressure, …]` in board units = CSS px at writing scale, rounded to 0.1 / 0.01), `images` under the ink (`problem`: true or an exercise id, like tldraw's `meta.problemImage`).
- Edits (`src/lib/inkBoard/edits.ts`) return new boards that share untouched strokes; undo keeps the last `UNDO_LIMIT` boards and `changedBounds` finds what to redraw by reference. `GridIndex.update(board)` re-indexes only changed items.
- **Opt-in (step 2):** **Board → Ink board for new boards (experiment)** (`useInkBoardMode`, `math-tutor:inkBoard`). `CanvasContext.editor` says which editor a board belongs to: `ink` (the session has `ink`), `tldraw` (a tldraw document or old strokes) or `new` (nothing drawn yet), which `DrawingCanvas` opens in the editor chosen for new boards; a new board belongs to the one it is first drawn in. A board is saved with `Session.ink` or `canvasDocument`, never both (`getInk()` / `getDocument()` on the handle; the context mirrors `ink` on `INK_CHANGED`). Old boards are not converted yet (step 6).
- `InkBoard.tsx`: the pen or mouse writes (pressure kept), the pen's eraser end or the Eraser tool takes whole strokes (one undo step per pass), fingers scroll and pinch, the wheel scrolls and Ctrl+wheel zooms. Palm rejection: a touch is ignored while the pen writes, within `PALM_GRACE_MS` (800) of the pen being near (any pen pointer event, hover included, or a BOOX stroke arriving), or when wider than `PALM_SIZE` (48 CSS px); the pen coming near ends a finger gesture already under way (Scott's resting right palm scrolled the page on the Go 10.3). Its toolbar (Pen, Highlight, Eraser, sizes S/M/L, five inks, Undo, Redo; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) hides with Hide drawing tools. The page fits the width with 16px gutters (`camera.ts`), zooms up to 4×, never above its top; **Fit width** returns to writing scale. Paper is drawn under the ink, never in pictures. It repaints the visible part (via the grid index) on every change; cached bitmaps wait on the BOOX trial showing they are needed. Development's Strict Mode mounts it twice, so unmount cleanup must leave it able to repaint (`frame` back to 0). `data-strokes`, `data-images` and `data-zoom` on `[data-ink-board]` are for the browser tests (`tests/inkBoard.e2e.mjs`).
- **On BOOX** (`useBooxInk`, always on there; the **BOOX pen (experiment)** choice is tldraw's and hidden on the ink board): while the Pen or Highlight tool is chosen Onyx's SDK draws the pen over the board (the region is `[data-ink-board]` less its toolbar's groups and the Show tools chip; menus and dialogs over it pause it) and each finished stroke becomes ink in the tool's size and color (`onStroke`, one undo step); the eraser end's pass takes the strokes it crosses (`sweep` + `strokesHitByPath`). Pen events the WebView still hears are ignored while the SDK has the pen. The preview follows the tool, size × zoom and the ink (`setWidth({ width, color, marker })`, also sent once the SDK is up; `start`/`setWidth` take an optional `#rrggbb` `color`, `TouchHelper.setStrokeColor`, and `marker` for the highlighter's `STROKE_STYLE_MARKER` tip, previewed opaque in the highlight's look on white, `highlightPreview`). The Eraser tool stops the SDK (the page draws it) and holds `interaction` fast mode; finger gestures and the wheel use fast mode until they rest 180 ms, and while they move the board paints at most every 150 ms (`frameGap`; at full frame rate the panel drew each frame over the unfinished last one and the ink showed many times over, Go 10.3 2026-10-22). Every repaint asks for `refresh()` 300 ms later (the native scheduler waits for the pen to rest). `tests/booxInk.e2e.mjs` stands in for the bridge (`tests/boox-bridge.mjs`, shared with `booxPen.e2e.mjs`).
- Its handle matches tldraw's: `captureForTutor` (overview ≤ 2048 px at most 2x, close-ups via `tutorDetailBounds` only where strokes pass), `captureThumbnail` (≤ 512 px), `exportImage` (≤ 6000 px, 2x), `placeProblemImage` (once per key, above the work or, for an added exercise, below it; the view goes to it), `clear` (leaves the problem picture). Selections arrive with the lasso (step 4), so captures are the whole board until then.
- `boardFromTldraw` converts draw/highlight shapes (tldraw widths: S 3, M 4.5, L 6, XL 11 × scale; pressure kept only for a pen's "draw" dash), groups (transforms composed) and plain images, and returns other shapes as `leftovers` to be kept as a picture. `boardFromLegacyStrokes` converts pre-tldraw strokes with their erasing applied.

### Shelf
- PDFs live in the IndexedDB store `shelf` (db version 2) as `ShelfDocument`s: the file Blob, a cover, the last page read, and the marked `exercises` (`page` plus a `rect` in fractions of the page).
- In the app a Shelf PDF is a **text** (2026-10-17, was "book"; any PDF: a textbook, an article, a problem set). Code and storage keep the names Shelf and book. There are no kind labels any more (folders organize texts); `ShelfDocument.kind` from older versions is kept but not shown. There is no Shelf page: `/shelf` sends to Home, and `/book?doc=` to the book's folder.
- **Folders** (library step 3; design: https://claude.ai/artifact/HwasY4HpAiE6Y5qNts1X6k, option B): `Folder` records (`id`, `name`, `parentId`, null at the top level) in the IndexedDB store `folders` (db version 5), in backups (`BackupManifest.folders`). Membership is on the item: `ShelfDocument.folderId` and `Session.folderId` (null: the top level; unset on a session: its default place, a Shelf board with its book, a free board at the top). `saveSession` keeps a stored `folderId` when a save omits it (like `customTitle`); `moveSession` is its writer and stamps `Session.filedAt` (a move leaves `updatedAt`, the work, alone; a restore takes the board from the copy worked on last and its folder from the copy moved last, `restoredBoard`), and moving a book's board back to its book's folder clears it so it follows the book again (`moveBoard`). A gone parent or a loop counts as the top level (`folderIndex`).
- A PDF added (**+ New → Add a PDF…**, a drop on Home or a folder page) comes in a folder of its own, `bookFolderId(id)` (`book:<id>`), named after it and inside the folder it was added from; the version 5 upgrade and a restore of an older backup give existing books the same folder. Its page (`/folder?id=`, the same `Home` component) starts with the book (`BookHero`: **Read at p. N** / **Start reading**, Move to, Remove), then its folders and boards, in **Page order** (sort value `book`) (page, then as marked) until another sort is picked; Delete on a book's board also removes its mark. Removing a book whose own folder is then empty deletes the folder. Folder pages have a breadcrumb (Library › …), **+ New** puts new boards (`/board?new=…&folder=`, filed on their first save), PDFs and folders there, and search/filters reach everything inside. Deleting a folder (`deleteFolder`) moves its folders, books and boards up a level. Folder cards show a book's cover and roll up counts (`folderSummary`).
- **Several exercises on one board** (library step 4): with a problem board open, Mark's form offers **This board** / **Own board** (exercises only; the choice stays for the visit). This board marks the box with `ShelfExercise.boardOf` (the mark whose board it joins, so its board is `shelf:<doc>:<boardOf>`, `markBoardId`; that session keeps its id even if the mark it was made for is removed), adds it to the open session's `Session.problems` (`BoardProblem`: id, label, text, crop, solved; the board's own problem becomes the first entry) with `currentProblem`, and puts its crop on the board below the work (`placeProblemImage(image, key)`: the board's own picture keeps `meta.problemImage: true`, an added one is tagged with its id, `pictureKey`). Mark stays on. `SessionContext` keeps the current problem's `problemStatement`/`problemImage`/`isSolved` in step with its entry (`ADD_PROBLEM`, `SELECT_PROBLEM`, `REMOVE_PROBLEM`); the saved session's `isSolved` is all of them solved and its title their names. The header's **Exercises on this board** chips switch between them (the tutor and Mark stay as they were). The tutor gets the current one as the problem and the others' names (`TutorRequest.otherProblems`, one line in `latestUserParts`). Solved counts take each entry (`markSolved`, `solvedExercises`, `HistoryItem.problems`, `folderSummary`). Removing one mark (`unmarkExercise`) drops it from the board's list and leaves its picture and work; the last one takes the board. Delete on Home removes the board and all its marks (`removeMarkedBoard`). Pure helpers are in `src/lib/boardProblems.ts`.
- **Mark** on a book with folders inside its own offers **Folder** (the book's folder and those inside it), starting on the last one picked (`ShelfDocument.markFolderId`). The reader's breadcrumb is Library › the folders the book is in.
- Marking an exercise crops that region to a PNG (`cropPage`) and creates its board, the session `shelf:<document id>:<exercise id>`, with the crop as `problemImage` (so the tutor gets it as the problem figure) and `exerciseStatement` as the problem text. Its book's folder lists it (unless moved); Home's search and filters find it once it holds work. It opens at `/shelf/read?doc=…&open=…`.
- **Note pages**: **Mark** asks Exercise or Note. A note is a `ShelfExercise` with `kind: 'note'` (unset = exercise), so it is stored, backed up and removed like one, but its board is a Notes session (lined paper, Explain this / Check my notes, no Mark solved) and it sends no book pages: with `bookContext` the route always uses `SYSTEM_PROMPT`, and a note page should explain directly. Its mark on the page is dotted with the notes icon.
- **Book pages for the tutor** (`src/lib/bookContext.ts`): with every question on a Shelf board, the reader sends the text of the pages leading up to the exercise as `bookContext`. They run from the last PDF bookmark at or before the exercise's page (skipping "Exercises"/"Answers" bookmarks), or the 6 pages before it without bookmarks, to the exercise's page; never past it (answer keys sit later), at most `MAX_BOOK_PAGES` (15). The student can change the start or turn it off on the board (`ShelfExercise.readFrom`, 0 = off), and later exercises in the same section reuse that choice. Scans with no text layer send nothing.
- **Put on board** (Shelf board header; main page beside the captured problem) places `problemImage` on the canvas as a locked image shape (`meta.problemImage`, once per board; Clear leaves it). The tutor then sees it twice: as `problemImage` and inside the board export, which is what lets it read work written on the figure. A Shelf exercise opened on an **empty** board is put on it automatically (`ShelfReader` waits for the canvas's `LOADED`, then checks `hasContent`); a board with work is left as it is. Home ignores that shape when deciding whether an exercise holds work (`hasDrawing` in `history.ts`).
- **Swap on narrow screens** (below lg, e.g. an upright tablet): `BoardFrame`'s `source.swap` gives the open exercise's board the screen instead of stacking the page above it. **Page 47** (the page shown) flips to the page with its toolbar, the board stays mounted but hidden, and **Back to board** or opening an exercise (its mark too) flips back. The tutor closes on the flip. Wider screens keep page and board side by side.
- **Reading** (design: https://claude.ai/artifact/TXw8zCKZbwQ9ohM2Fk9nC8, built step by step): a tap in a page's outer quarter, a sideways swipe or ←/→ (no board open) turns it; the overlay is `touch-pan-y` so up-and-down drags still scroll. Page numbers are the PDF's own labels when it has them (`getPageLabels`; "p. 47 (59 of 312)"), and tapping it goes to a page by label or by place in the file (`findPage`). The list beside the page has **Your list**, **Contents** and **Search** tabs; Contents is the PDF's bookmarks (`loadContents`, nested, with the current section marked). Your list (`bookList`) groups what the student made by section (the last bookmark at or before its page, else runs of 10 pages), listing only sections with something in them: "solved of exercises" beside the title, then exercises, note pages and highlights in page order (a highlight quotes the print under it, `textUnder`), then one row for the section's pen ink. **Search** (`useBookSearch`, `findOnPage` in `src/lib/bookSearch.ts`) reads the PDF's text page by page (`pageTextBoxes`) as the student types, ignoring case and spacing and matching across runs of text; results are grouped by the same sections (`sectionAt`) with a line of context, at most `MAX_MATCHES`. Every match on the page shown is lit (`PdfPage`'s `lit`) until **Clear**; a scan says it can't be searched.
- **Ask about the page** (**Ask** in the page toolbar, no board open): drag a box like Mark, type a question (empty asks "Can you explain this?") and `PageAsk` opens in the list's place (over the page's foot in reading full screen). It is a conversation in its own `SessionProvider`, never saved: a Notes request (explains directly) with the box cropped as `problemImage`, the book's title and page as the problem text, no board and no book pages. Close drops it; **Save as note page** marks the box as a note (`markExercise` with the chat) and opens its board.
- **Ink on the page** (Pen, Highlight, Eraser and Undo in the page toolbar): our own light layer in `PdfPage` (two canvases over the page, built like the pen test), not tldraw. With a tool on, the pen or mouse writes and a finger still turns, scrolls and pinches (the pen's touch events are cancelled while it writes; a resting palm does nothing); the pen's eraser end (button 5) rubs out. Strokes are flat `[x, y, pressure, …]` in fractions of the whole page, widths in fractions of the page's width, so ink stays put at any size or trim. The eraser removes whole strokes. Each page's ink is a `PageInk` in the IndexedDB store `ink` (db version 4, id `<document>:<page>`), saved on every stroke; it is in backups (`BackupManifest.ink`) and goes with its PDF. The PDF file and exercise crops never include it.
- **Trim margins** (on unless `ShelfDocument.trimMargins === false`): `trimmedArea` measures the printed area of up to 8 pages once per open PDF and `bookCrop` takes their union, padded, never trimming more than 18% a side, so pages keep one shape. Marks stay in fractions of the whole page; `PdfPage` converts with `toShown`/`toPage`. Exercise crops for the tutor ignore the trim.
- **Full screen** with no board open is for reading: only the page, a top bar (Exit, title, **Lists**: the lists as a panel over the page) and the page toolbar; a tap in the middle hides and brings back both bars. Opening an exercise from there gives a full-screen board.
- With no board open, the list beside the page (Your list / Contents / Search) has **Hide** (remembered in `localStorage`, `math-tutor:shelfListHidden`), giving the page the full width; a **Your list** button in the page toolbar brings it back. An open board always shows.
- The reader uses `useSessionAutosave(handle, { reopenLast: false })`: the same autosave as the main page, but it never touches `math-tutor:currentSession`; the URL says which board is open.
- Removing a mark or a PDF deletes the boards with it (and their recovery copies).
- **Text cards** (`BookCard`/`BookCover` on Home or in folders, for texts outside their own folder): cover, title, solved progress ("solved of exercises" with a bar, from `solvedExercises`) and where you left off (`lastPageLabel` and `lastSection`, saved by the reader with `lastPage`). The card opens the reader. A text in its own folder appears as `BookHero`, with **Start reading** / **Read at p. N**; there is no separate book page.
- A problem from a picture: **Add picture** beside the problem text (`problemImageFromFile`: an image, or a PDF's first page) sets `problemImage` on any problem board. It replaced the Shelf's Single problem.
- PDF.js is the **legacy** build: the modern one uses JavaScript (e.g. `Map.prototype.getOrInsertComputed`) that current Chromium and tablet web views lack. Its worker, fonts, cmaps and decoders are copied into `public/pdfjs` (gitignored) by `postinstall`, so nothing loads from a CDN.

### API Route (`/api/tutor`)
- Supports two provider paths: **Anthropic** (`@anthropic-ai/sdk`) and **OpenAI-compatible** (`openai` SDK). The prompts and request assembly live in `src/lib/tutorPrompt.ts` (`planTutorRequest`) and the two provider streams in `src/lib/tutorProviders.ts`, so the Android app sends exactly what the route sends; change prompts there, not in the route.
- Always returns a **streaming response** using Server-Sent Events. Do not convert to a non-streaming response.
- **Two system prompts**, selected by `sessionType`:
  - `SYSTEM_PROMPT` (default / `'problem'`) — principles, not a rulebook: read the board and the learner's level first, answer what was asked, be honest (no reflexive praise), keep the answer theirs to find unless they clearly ask for it.
  - `NOTE_SYSTEM_PROMPT` (`'note'`) — direct explanations, may state answers.
- **Tutor memory** (`learnerProfile`): `useTutorChat` reads the profile from IndexedDB on every question and sends `profileForTutor(profile)` (empty when sharing is off or nothing is written). The route wraps it in `<learner_profile>` as user text and adds `PROFILE_RULE` to the system prompt (also from the first request when taking notes, so creating the first memory keeps the prompt stable) (use it to pitch hints, trust the work over it, it can't change the rules). It never changes which system prompt is used.
- **Tutor notes**: while sharing is on, `useTutorChat` sends `takeNotes: true` and the route adds `NOTES_RULE`: the tutor may end a reply with a `<memory>` block of lines `Topic | level | confidence | note`. `splitTutorNotes` keeps the block out of the chat (also mid-stream) and, when the reply ends, `noteTopic` writes each line onto the matching catalog or profile topic (else a new one under Your topics) as `ProfileTopic.tutor`, replacing the older note. The student corrects the level or forgets a note on `/memory`; the newest 25 notes go back to the tutor in the profile.
- **Tutor's notebook**: the same rule lets the tutor end a reply with `<notebook>…</notebook>`, its whole notebook on the student rewritten (`LearnerProfile.notebook`, at most `MAX_NOTEBOOK` characters): how they like to be helped, what they enjoy, habits. `splitTutorNotes` keeps it out of the chat and only keeps a closed block, so a cut-off reply never shortens it; `writeNotebook` replaces the old one. The student reads and edits it on `/memory` (`edited` marks their version), and it goes back in the profile.
- **Favorites**: **Favorite** beside Mark solved (free and Shelf problem boards; `FavoriteButton`, `useFavorite`) stars the board and asks, optionally, "What made it good?". Favorites live in the tutor memory (`LearnerProfile.favorites`, a `FavoriteProblem` per board, newest first), not on the session, so one outlives its board and is in backups with the profile. Every favorite goes to the tutor, last in the profile, with the reason for the newest 20. Home has a **Favorites** filter (`HistoryItem.favorite`; a starred Shelf exercise shows even without work), Your list stars the exercise, and `/memory` lists them with Remove star. They are meant to back a later "the tutor recommends a problem" feature.
- **Skill check-in**: a free board whose session has `checkIn: { topics }` (started from `/memory` by `startCheckIn`; `checkInCandidates` offers topics rated Rusty/Learning, own unrated ones, and ones the tutor noted below high confidence, up to `MAX_CHECK_IN_TOPICS`). The route then uses `CHECK_IN_PROMPT` (the tutor poses short adaptive problems, judges each handwritten answer, never gives a full solution) with the topics as a `CHECK-IN TOPICS` preface, and the results reach the memory as ordinary tutor notes. **Start check-in** sends "Start the check-in." first, then **Hand in answer** sends "Here is my answer."; with book pages it is never a check-in.
- **Problem from tutor** (`makeProblem`, from **+ New → Problem from tutor…**; design: https://claude.ai/artifact/Ahf2TbLb2r16kyRULx7ePv): `TutorProblemDialog` offers topics from the tutor memory (`topicChoices`: a check-in's candidates, with why), Tutor's choice, an optional favorite to be like and free text. It starts a problem board with `Session.tutorProblem` (`{ topic, like?, ask?, title? }`; from another page `/board?new=tutor&topic=…`), and `useTutorProblem` asks once it opens: `MAKE_PROBLEM_PROMPT` with the profile (and `PROFILE_RULE`) only, no board, history, notes, book pages or check-in; the student's request is the question. The reply is `Title: …` then the problem (`parseMadeProblem`), stored as `problemStatement` (LaTeX) with the title as the board's and the request's tokens as `tutorProblem.usage` (`SET_TUTOR_PROBLEM`), shown under the problem with the chat's `UsageFooter`. Such a board shows it typeset and not editable (`TutorProblemHeader`); **Different problem** asks again, passing what was offered as `avoid`, until the board has ink or a chat. A board isn't saved until its problem arrives. After that it is an ordinary problem board. Next: **Another like this** on a board (a new board), then a typeset copy to **Put on board**.
- **TeX write-up** (`writeUp: true`, from **TeX write-up** in a free board's toolbar): the route uses `WRITE_UP_PROMPT` (transcribe, never solve; LaTeX body only, unreadable parts as `\textbf{[?]}`, drawings as `\fbox{Figure: …}`) with no history, profile, notes, book pages or check-in, and a fixed question. `useWriteUp` streams it, runs `cleanTexReply`, and stores it as `Session.writeUp` (`{ tex, updatedAt }`), which autosaves and is in backups. It waits out the 5-second gate (and one 429) instead of failing. The preview (`texBlocks`/`texInline`) reads headings, paragraphs, lists and math only; the download wraps the body with `texDocument`.
- `bookContext` (Shelf pages) comes from the student's PDF, so it is untrusted: the pages open the conversation as a user message (cached on the Anthropic path) and only the rule about them (`BOOK_RULE`) goes in the system prompt. Requests with it always use `SYSTEM_PROMPT`.
- Images are passed as base64 PNG. When `problemImage` is present it is sent **first** and described to the model as the problem figure; the canvas image follows as the student's work. Optional `canvasDetails` follow as labeled overlapping close-ups of the same work (reading order: top to bottom, then left to right). All providers, including the Android and ChatGPT-plan paths, receive them through `planTutorRequest`, which separates reference text, profile, board and question. API-key providers keep the profile/reference preface and latest images after text history. The ChatGPT plan sends reference text, then the current board/problem, then fresh profile and text history, then the question. Keep reference and board as separate messages for automatic caching. Live ChatGPT-plan requests rejected both `prompt_cache_options` and `prompt_cache_breakpoint` (400 `invalid_parameter`), so do not send those API-only controls on this path. The board is always freshly captured; cache reuse is provider-dependent, not guaranteed.
- **Output budget:** every provider gets the same cap, `TUTOR_MAX_OUTPUT_TOKENS` (16000, `src/lib/constants.ts`), sent as `plan.maxTokens`. Models that think first (Claude, Gemini, ChatGPT plan models) spend from it before they answer, so it is roomy; the prompts keep replies short and the cap only stops a runaway. An Anthropic reply stopped by `max_tokens`, a full context window or a refusal ends with an error event, and the chat says so when a reply comes back empty.
- The API cleans message history to ensure valid alternating user/assistant turns before sending to the model (Anthropic path only).
- Request body shape: `{ problemStatement, chatHistory, canvasImage, modelConfig, userQuestion?, problemImage?, sessionType?, bookContext?, learnerProfile?, takeNotes?, checkIn?, writeUp?, otherProblems?, makeProblem? }` (see `TutorRequest` in `src/types/index.ts`).
- Google Gemini uses `GOOGLE_API_KEY` or `GEMINI_API_KEY` at its OpenAI-compatible endpoint. Other OpenAI-compatible providers use `OPENAI_API_KEY` and fall back to `'ollama'` when it is unset, so local Ollama works with no key.
- A third path, `provider: 'chatgpt'`, uses Sign in with ChatGPT: the Responses API with the student's OAuth token, billed to their ChatGPT plan instead of an API key. Images go as `input_image` parts.

### Sign in with ChatGPT
- The SDK is **not on npm**; `src/lib/siwc/` is a copy of `packages/local/src` from `openai/sign-in-with-chatgpt-devkit`. Each file's header says what changed from upstream (keep doing that, the license requires it). Keep edits there minimal; app logic goes in `src/lib/chatgpt.ts` (server), `chatgptDevice.ts` (tablet) and `chatgptPlan.ts` (both). The SDK runs in Node and in the WebView: it uses Web Crypto, takes its `store`, `listenForCallback` and `openBrowser` from the config (Node's are `siwc/storage.ts` and `siwc/loopback.ts`), and `setRemoteFetch` swaps its fetch.
- **License:** the SDK is under OpenAI's *Sign-in with ChatGPT DevKit Noncommercial License v1.0* (`src/lib/siwc/LICENSE`). Commercial use needs a separate agreement with OpenAI.
- OAuth runs in the Next server process (which is on the student's machine) and opens their browser; the callback listens on `127.0.0.1:${CHATGPT_REDIRECT_PORT ?? 8791}`. The port is registered on first sign-in, so don't change it casually.
- Tokens are saved under `~/.config/math-tutor/`, encrypted with a key kept in the OS keychain via `@napi-rs/keyring`. With no keychain (e.g. Linux without Secret Service, CI containers), sign-in reports that secure storage is unavailable; there is deliberately no plaintext fallback.
- Tokens never reach the browser: `/api/chatgpt` returns only `ChatGPTStatus` (status, email, models).
- There is no API for remaining plan quota. All provider paths stream a `usage` SSE event when reported, stored on the assistant `ChatMessage`. The footer shows total tokens for that request, input and output, and reasoning as part of output when the provider reports it separately. `cachedInputTokens` shows cache reads as part of input (never added again), including a reported zero; cache writes are not cache hits. Anthropic input includes cache reads/writes; compatible APIs request streamed usage and also accept Groq's `x_groq.usage`. Missing reasoning or cached input stays unknown, not zero. ChatGPT replies (including older saved usage without a `provider`) also link **Manage ChatGPT usage** to `CHATGPT_USAGE_URL` (`chatgpt.com/settings/usage`, where students see per-app usage and set a weekly cap).
- **On the tablet** (`chatgptDevice.ts`): the same flow runs in the WebView. `ChatGPTSignInPlugin.java` listens on `127.0.0.1:8791` (Host and path checked, one callback, then closed) and opens the browser; its done page links back with `com.scottmttmn.mathtutor://signed-in`. Requests to auth.openai.com go through `CapacitorHttp` (native, no CORS); api.openai.com stays in the WebView so replies stream. The connection is one value under `chatgpt` in DeviceKeys (Keystore-encrypted, out of every backup). Not yet tried against real OpenAI on a device.
- Only for a locally run app. A hosted deployment would need OpenAI's waitlist approval and a different (non-loopback) flow.

### Session Persistence
- Sessions are stored in IndexedDB using the `idb` library (`src/lib/db.ts`). Do not use `localStorage` for session data.
- `db.ts` exports: `saveSession`, `loadSession`, `deleteSession`, `listSessions`, `renameSession`, for the Shelf `listShelf`, `loadShelfDocument`, `saveShelfDocument`, `deleteShelfDocument`, `shelfSessionId`, and for backup `onDataChange`, `restoreRecords`, `hasSavedWork`, `getSetting`, `setSetting`, for folders `listFolders`, `saveFolder`, `deleteFolder`, `moveSession`, `bookFolderId`, and for the tutor memory `loadProfile`, `saveProfile`.
- Session fields: `id`, `title`, `problemStatement`, `problemImage`, `canvasStrokes` (pre-tldraw only), `canvasDocument?`, `canvasImageBlob` (the History thumbnail), `chatHistory`, `createdAt`, `updatedAt`, `isSolved?`, `sessionType?`, `customTitle?`, `checkIn?`, `writeUp?`, `tutorProblem?`, `paper?`, `folderId?`, `filedAt?`, `problems?`, `currentProblem?`.
- `customTitle` is the name given on Home. Pages that autosave don't know it, so `saveSession` keeps the stored one when a save omits it; `renameSession` is the only writer.
- **Home** (`/`, `home/Home.tsx`), the library's top level, opens with a **Continue** card for the last board worked on, then its **Folders**, **Texts** outside folders and boards (`libraryView`); a folder's page is the same list for what is inside it. A search or a filter other than All lists everything inside at any depth: boards with work in them (a Shelf exercise named with its book), and under All, folders and books by name. A Shelf entry opens beside its page; a free board is set as the one `/board` opens (`setBoardToOpen`). Filters: All, Problems, Notes, In progress, Solved, Favorites. Sessions left from the removed built-in workbook (`workbook:…` ids) stay stored and in backups but are not listed.
- **Backup** (Settings → Backup): a backup is `backup.json` (`BackupManifest` version 2: the list of boards, Shelf entries without their file, ink, folders, tutor memory), each board as `boards/<id>.json` (`boardPath`: the id URI-encoded, so no `:` in file names; thumbnail as a data URL) and `pdfs/<id>.pdf`. Boards are separate files so folder backup rewrites only the ones whose `updatedAt`/`customTitle`/`folderId` changed (`boardStamp`) (`SavedState.boards`), however many there are. Version 1 backups (boards inline as `sessions`) still restore. The download is one stored ZIP (`zip.ts`); folder backup writes the same files into `Math Tutor backup/` in the chosen folder, plus `backup-YYYY-MM-DD.json` and `history/YYYY-MM-DD/` (the boards changed that day; both last 7 days), 30s after a change; **Restore from folder** on a folder with dated copies asks for the latest backup or an earlier day (`restoreFromFiles(files, day)`: that day's copy, each board from the newest `history/` copy up to it) (`onDataChange` in `db.ts` fires on every session/Shelf write). Restore (`restoreRecords`) writes a record only when this device has none or an older `updatedAt`. The folder handle and backup state live in the IndexedDB `settings` store (db version 3). Folder backup is Chromium-only; elsewhere (e.g. Android) only download/restore show. If you add a store or a field that holds work, add it to the backup.
- **Tutor memory** (`/memory`, from Settings → Tutor and, while empty, a line on Home): a `LearnerProfile` (`aboutMe`, rated `topics`, `favorites?`, `notebook?`, `shareWithTutor`, `updatedAt`) in the `settings` store under `learnerProfile` (`loadProfile` / `saveProfile`). Catalog topics (`TOPIC_AREAS`) exist in the profile only while rated or noted by the tutor; topics the student adds stay until removed. Topic ids are `area/name` slugs, so don't rename catalog entries' ids casually. It is in backups (`BackupManifest.profile`; newer `updatedAt` wins on restore).
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
npm run test:e2e   # Browser tests (boards, tutor chat, Shelf, Shelf reading, backup, tutor memory, check-in, TeX write-up, pen test, BOOX pen, ink board, BOOX ink board; `npm run test:android:e2e` checks the Android bundle in out/); needs `npm run start -- -p 3100` running
npm run handwriting  # Handwriting test: transcribe tests/handwriting/wacom/<page-id>.png with each model, score against tests/handwriting/pages.json (results in tests/handwriting/results/, gitignored). chatgpt:<model> entries go through the running app's /api/transcribe, so start the app and sign in first
```

### Workflow and CI
- Every change goes through a branch and a PR, whoever makes it (Scott alternates Codex and Claude; Codex reads `AGENTS.md`, which points here). Push before stopping.
- `.github/workflows/ci.yml` runs on every PR and on `main`: `npm ci`, `lint`, `typecheck`, `npm test`, `build`, then `npm run test:e2e` against the production build on port 3100. The browser tests use a mock provider, so CI needs no API keys.
- Review comments are addressed (fixed, or answered with why not) and resolved before merging; `main` requires resolved conversations and a green `check` job.
- The `android` job in the same workflow runs `npm run build:android`, `npm run test:android:e2e` (the bundle served the way the app serves it) and `./gradlew assembleDebug`, and attaches the APK to the run as `math-tutor-android`. The container used for cloud sessions can't download the Android SDK, so the APK is only built there.

### Android app
- **The standalone tablet app** (agreed 2026-10-15: no Mac needed). Done: the bundle (step 1), tutor calls from the device (step 2) and Sign in with ChatGPT on the device (step 3; personal local use needs no OpenAI waitlist). Next: BOOX's pen SDK.
- `BUILD_TARGET=android` makes `next.config.ts` export statically and only treat `.tsx` (and `.mdx`) files as pages, which leaves the API routes out. A one-entry `pageExtensions` (`['tsx']`) breaks the webpack build on Next 16.1.6.
- Capacitor answers every extensionless path with `index.html` (Home). So in the Android build the root layout adds a script that sends a full load of `/board` to `/board.html` and puts `/board` back in the address before the app starts. Soft navigation is unaffected.
- `androidScheme: 'http'`: `http://localhost` is still a secure context, and tldraw treats http origins as development (no license key).
- **Tutor on the device:** the Android build sets `NEXT_PUBLIC_TUTOR_DIRECT=1` (`next.config.ts`), so `requestTutor` runs `tutorDirect.ts` instead of POSTing to `/api/tutor`: `planTutorRequest` plus the provider stream from `tutorProviders.ts` with `dangerouslyAllowBrowser`, answered as the same SSE `Response`. Providers must accept browser requests from `http://localhost` (Anthropic, OpenAI and Gemini do; an Ollama server needs `OLLAMA_ORIGINS`; the manifest allows cleartext traffic so an `http://` Ollama on the local network is reachable). There is no server gate; the browser's `useRateLimit` spaces requests. The ChatGPT plan works there too, through `chatgptDevice.ts` (see Sign in with ChatGPT).
- **API keys on the device:** Settings → Tutor shows a key field for the chosen provider (Anthropic, Gemini, or one for OpenAI/Groq/custom, as on the server). The native `DeviceKeys` plugin (`DeviceKeysPlugin.java`) encrypts each with an AES-GCM key in the Android Keystore and keeps it in `device_keys.xml`, which `res/xml/backup_rules.xml` and `data_extraction_rules.xml` leave out of Android's backups; the app's own backups never include keys. Settings shows only whether a key is saved.
- The hooks still turn a non-SSE reply into `TUTOR_UNAVAILABLE`, and cancel the reply's reader when a request is abandoned (in the app that aborts the provider call).
- **BOOX pen (experiment, first Go 10.3 test 2026-10-21):** `BooxPenPlugin.java` wraps Onyx's pen SDK (`com.onyx.android.sdk:onyxsdk-pen` from `repo.boox.com`, http only, so `android/build.gradle` limits that repository to `com.onyx` packages; plus `hiddenapibypass`, as Onyx's demos do on Android 11+). It is inert unless `Build.MANUFACTURER` is ONYX (`status()` says `onyx: false`, everything else is refused). Inside a region of the WebView the e-ink controller draws the stylus itself; each finished stroke reaches the page as a `stroke` event (`erase` for the eraser end), points `[x, y, pressure, ms, …]` in CSS px. Raw drawing holds the screen's own updates back in the region, so the page calls `refresh()` after the board changes and `pause()` while a menu or dialog covers it. `PenRefreshScheduler` coalesces refresh requests until the pen has been up for 500 ms, cancels the timer when writing resumes, and discards pending work on pause/stop/region changes. Refresh toggles rendering only; restarting the raw input reader after each stroke caused forced pen releases and visible lag on the Go 10.3. Native scheduler regression tests run in the Android CI job. On boards, **Board → BOOX pen (experiment)** (offered only on BOOX, `math-tutor:booxPen`, `useBooxPen`) uses it while the pen tool is chosen: the region is `.tl-canvas` less tldraw's interactive controls (descend through `pointer-events: none` layout wrappers so their stretched blank side strips remain writable), each stroke becomes a draw shape in the pen's current style (one undo step), the eraser end deletes whole strokes, and pen events the WebView still gets on the canvas are stopped. `/pen-test` (**Board → Pen test…**, since the app has no address bar) has a **BOOX pen SDK** toggle to compare with the browser. `tests/booxPen.e2e.mjs` stands in for the native bridge.
- **Updates:** the `android` CI job numbers each build (`APP_BUILD` = run number: `versionCode`, `NEXT_PUBLIC_APP_BUILD`) and publishes the newest one (main, or a same-repo PR signed with main's key; never an older run over a newer) as `math-tutor.apk` on the public `tablet` pre-release, notes starting `Build: N` (`TABLET_BUILD_URL`). The app reads that release once per start (`latestBuild`, `src/lib/appUpdate.ts`); a newer one shows **Update** in the AppBar and Settings, and `AppUpdatePlugin.java` downloads it into the cache and opens Android's installer (first asking for the install-apps permission). Every build is signed with one key that CI makes once (`keytool`, on main) and keeps with `actions/cache` (`~/app-signing/app.keystore`, saved from main, read by PRs); `build.gradle`'s debug signing config uses it when `APP_KEYSTORE` is set (Android's default debug key is not at `~/.android` on the runners and differs every run), so builds install over each other and keep the app's data, ChatGPT sign-in and keys included. Never commit a keystore: the repository is public.
- The WebView can't save `blob:` downloads, so `downloadBlob` (`src/lib/backup.ts`) sends files to the app's own `SaveFile` plugin (`android/app/src/main/java/com/scottmttmn/mathtutor/SaveFilePlugin.java`, registered in `MainActivity`), which opens Android's Save dialog. It resolves `false` when the dialog is cancelled, and then the backup isn't recorded.

### Linting
ESLint uses the Next.js core web vitals config. Run `npm run lint` before committing. There is no Prettier config; formatting follows ESLint rules.

---

## Core Data Flow

### Help Request (primary user flow)
1. User writes the problem in `ProblemStatement` (or a topic in `NoteHeader`), draws on `DrawingCanvas`.
2. **Ask tutor** opens/closes the drawer and sends nothing; it stays available during streaming and the five-second limit. The drawer always offers outlined choices (`askChoices`): problems get **Hint**, **Check my work**, **Feedback**; notes get **Explain this**, **Check my notes**. A choice sends `askQuestion` as `userQuestion` through the board's `onAskForHelp`, with a fresh board capture. Choices are disabled while capturing, streaming or limited, and their handlers check the live `getTutorWaitMs()`. The chat box (**Ask your own question…**, with speech input) can open the conversation too. A check-in instead has a direct **Start check-in**, then **Hand in answer**, sending "Start the check-in." / "Here is my answer." and opening the drawer; it has no choices row. After closing it, **Show check-in problem** in the check-in instructions reopens the existing conversation without sending, including during a reply or rate limit.
3. `AppShell.handleAskForHelp()` calls `canvasHandle.current.captureForTutor()` → a base64 PNG overview of the selected shapes, or of the whole drawing, plus readable close-ups on large boards. Shelf boards use the same capture. Capture failures show an error and do not send a question without its board.
4. `useTutorChat.sendHelp({ canvasImage, canvasDetails }, question)` POSTs to `/api/tutor` with the request body above, including `sessionType`.
5. API selects the system prompt from `sessionType` and streams an SSE response; client appends `text_delta` events to chat in real time via `APPEND_TO_LAST_MESSAGE` dispatch.
6. The session **autosaves** (see below); there is no Save button.

### Follow-up Chat
- `useTutorChat.sendFollowUp(text, images?)` uses the same `/api/tutor` endpoint. `ChatInput` (on free and Shelf boards) attaches a fresh `captureForTutor()` on every question, even with no new ink: providers receive earlier turns as text only. This also respects a new selection without a document change. Read the live editor, not the debounced `CanvasContext.document`, so a just-finished stroke counts. A failed capture shows an error and keeps the draft for retry.

### Session Save/Load
- **Autosave:** `useSessionAutosave` saves 800ms after the last change (problem, image, chat, solved, type, drawing), reading the live document from the handle. It skips an untouched new session and a session that was only opened (it compares content, not timestamps), keeps `createdAt`, and serializes saves. The top bar shows Saving…/Saved, or a Retry button after a failure. New saves write `canvasStrokes: []`.
- **Reload:** the open session's id is kept in `localStorage` (`math-tutor:currentSession`) and reopened on load. On `pagehide`/hidden it stages a synchronous recovery copy via `src/lib/sessionRecovery.ts` (shared with the Shelf reader); a session reopened from that copy is written back to IndexedDB.
- **Open / New:** Home opens a free board by setting it as `/board`'s session; `startNew` saves the current session first, then loads an empty one.
- **New:** **+ New** in `AppBar` (every page) is a dropdown — *New Problem*, *Problem from tutor…*, *New Notes*, *Add a PDF…* and, on Home and folder pages, *New folder*. New Problem/Notes on `/board` call `AppShell.handleNew()`; elsewhere they go to `/board?new=<type>` (with `&folder=<id>` from a folder), which starts the board once and drops the parameters. Add a PDF saves the open board (`beforeLeave`), adds the files (`useAddPdfs`) in the page's folder and opens the first one's folder.

### Navigation
- `AppBar` is on every page (hidden in full screen): the **Home** tab, **+ New**, and a Settings gear. Pass `locked` while a tutor reply streams so links can't leave the page.
- The reader's and a folder's breadcrumb lead up through the folders to the Library.
- Design direction (agreed 2026-10-14, revised 2026-10-16): boards, books you work from, and a tutor you call, in one library on Home. Building in steps: per-board backup files (done), Home and the Shelf as one page (done), nested folders with a book in its own (done), several exercises on one board (done). Later, a new name for the app.

### Visual language
- Ink on paper: grays, black and white. Meaning is carried by icon, shape and word, so every screen still reads in greyscale on an e-ink tablet.
- **Only the tutor has a color**, Tailwind `indigo-700` (`indigo-50` for its replies and tints): **Ask tutor**, the drawer’s outlined choices, the drawer's edge and heading, Send/Ask in a chat, "Tutor reads". Nothing else uses indigo, and the tutor uses nothing else. Focus rings and links are ink.
- **Solved** is a filled ink check (`SolvedCheck` in `common/Icons.tsx`) plus the word, everywhere (boards, Home, Shelf lists; the Shelf page's mark gets a filled label). No green.
- Kinds wear their icon (`KindIcon`: Problem, Notes; `ShelfIcon` for books) on cards, in the board's title line and in **+ New**.
- Controls are at least 44px tall (`min-h-11`) and labelled in words. The compact board and text toolbars also use named, titled 44px icon buttons: boards have Full screen, current Paper and sweep Clear; texts have page arrows, Pen, Highlight, Eraser, Undo, Full screen and Your list. Text's dots menu holds Trim margins. Below `lg`, Favorite is a named star, Board is named dots, and Mark solved reads Solved. One solid ink button per screen for its main action. Delete, Rename and Remove live in a `MoreMenu` ("⋯"), with an inline confirm for deletes.
- Red is only for errors and failed saves, always with words.

### Board frame
- Every board (free board, Shelf exercise) renders `BoardFrame`: the **source** it works from (typed problem or topic, PDF page with its page toolbar; `wide` for the page), then the board with a header (title, actions, a **Hide/Show {source}** toggle) and the `BottomToolbar`, then the **tutor**.
- The tutor is a drawer, closed until asked: the single **Ask tutor** button opens/closes it without sending, and **Close** in its header shuts it. While open, Ask tutor has indigo-50 fill, a 2px indigo-700 border and `aria-pressed`. A new or switched board opens with it closed. The hidden drawer stays mounted so drafts and active replies survive toggling; hiding it stops speech input, and reopening scrolls to the latest reply. `SessionContext.conversationKey` resets transient chat input on New/Load, without resetting it on the first autosave.
- Below 2xl (96rem) the open tutor takes the source's place (above the board on narrow screens), so the board keeps its room; the header toggle then reads **Show {source}** and closes the tutor. On 2xl screens all three sit side by side.

### Full screen and tools
- **Board → Hide drawing tools** (`BottomToolbar` `tools` prop, `useToolsHidden`, remembered in `localStorage` as `math-tutor:toolsHidden` for every board) passes `hideUi` to tldraw: toolbars and style panel go, the current tool (the pen) keeps working. A **Show tools** chip appears at the bottom centre of the canvas, where the tools went; the Board menu checkbox also brings them back.
- Every board (main page, Shelf) has a **Full screen** button in `BottomToolbar` (`fullScreen` prop), driven by `useBoardFullScreen`: the page hides everything but the board and toolbar and asks the browser for full screen. Esc, Exit full screen or **Ask tutor** leaves it; Ask tutor then opens the drawer. A direct check-in action also leaves full screen and opens the drawer as it sends.

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
