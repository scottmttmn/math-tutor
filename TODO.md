# TODO

Goal: make Math Tutor a great math notebook on its own, even for someone who never uses the AI tutor. The primary audience is the self-motivated learner who enjoys math, at any skill level.

Direction: pen-first and keyboard-free. The end state is an Android app on an e-ink tablet (BOOX in mind), with the web app in a thin shell plus the tablet's pen SDK, and no laptop needed. The shell waits until there is a device to test on; until then, check that every feature works pen-only at tablet size. See `docs/pen-first-math-workbook-plan.md`.

Work top to bottom unless priorities change. Every change goes through a branch and a PR (see CLAUDE.md, "Workflow and CI").

Done: the handwriting test, autosave on the main page, the 5-second request limit, CI on every PR, thinner default pen.

## MVP

### 1. Handwriting test set

- Pages of real handwriting (written on a Wacom in the app) with a LaTeX answer key, in `tests/handwriting/`. Done (2026-10-09): Claude Sonnet 5.5, Claude Opus 5.5 and ChatGPT-plan Sol 6.1 each read 99%; their misreads are lookalikes (O/θ, q/9, S/5) and the odd dropped sign or row. Luna (91%) invented a whole page of work, so it isn't used for reading handwriting. Gemini 3.8 Flash's free tier was rate limited before it could finish.
- A script (`npm run handwriting`) sends each page to every configured model and scores the transcription against the key, so we know which models read handwritten math well enough before building on recognition.

### 2. Problem history

Done: **History** (top bar) replaces the Load popup with a full-screen grid of every free-form board and every workbook exercise or reading that has work in it, with thumbnails, search, rename, sort, and filters (All / In progress / Solved / Notes). Workbook entries open in the workbook.

- Shelf exercises join History too.

### 3. PDF Shelf

Done: **Shelf** (top bar) holds PDFs added or dropped in. Open one to read it page by page; **Mark exercise** and drag a box around a problem, and it opens on its own board beside the page (below it on an upright tablet), stays marked on the page (✓ once solved), and shows in History. **Single problem** puts a picture or a PDF's first page straight onto a new board. Works offline; the tutor gets the marked region as the problem figure, plus the text of the book pages leading up to it (from the section's bookmark, at most 15 pages, never past the exercise; adjustable or off on the board).

- Still to do: a PDF's pages scroll one at a time (no continuous scroll or zoom yet); marks can't be moved or renamed after saving.

### 4. Export and auto-backup

- Export a page as PNG or PDF.
- Export and import every notebook as one file, and back up automatically to a folder the user picks (e.g. a Dropbox folder). No server or account.
- Ask the browser for persistent storage so IndexedDB isn't evicted.

### 5. Tutor memory

- A local, user-editable learner profile, summarized after each session and sent with tutor requests (not the raw history).
- Kept in app storage, so it moves with the app to the tablet.
- **Self-assessment** (optional): pick topics and rate each one (solid, rusty, learning, never seen), plus a free-text "About me". This is the tutor's starting picture of the learner.
- Each topic in the profile has a level and how sure the tutor is of it. Everyday boards keep updating it, so one old answer never fixes a wrong picture in place.

### 6. Skill check-in

- Optional and short, never required. Starting from the self-assessment, the tutor skips topics rated solid or never seen and asks a few problems on the uncertain ones: harder after a right answer, easier after a miss, stopping once it is confident.
- Answers are handwritten on a normal board, so it stays pen-first and reuses the existing tutor flow.
- Results write into the tutor-memory profile (levels and confidence), which the learner can see and edit. Also available later as **Check me on this topic** for one area.

## After the MVP

- **Handwriting to TeX write-up.** Work by hand, write a neat version, then **Convert to TeX**: an editable LaTeX document with a live KaTeX preview, downloadable as `.tex` (drawings exported as images). Converting a selection in place is a smaller version. Depends on the handwriting test results.
- **Replace the chat pane.** Pen-only actions on a selection (Explain this, Give me a hint, Review my work), with replies as cards beside the work. The tutor waits until invited.
- **Android shell** for the tablet, once there is a device to test pen latency on. Sign in with ChatGPT won't carry over there; API keys will.
- More openly licensed workbook sections at different levels (today there is one section of one book).

## Later

- Multi-page notebooks (tldraw supports pages; they're turned off today).
- Highlights and margin notes in the workbook reader.
- Graph paper background and function plots on the canvas.

## Down the road (not now)

- Mark a problem as **interesting**. A star on saved problems is cheap once problem history exists.
- Eventually: a crowdsourced network of problems. Solve one, mark it interesting, and get recommendations for others.
