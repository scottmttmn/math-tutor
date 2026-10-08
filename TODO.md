# TODO

Goal: make Math Tutor a great math notebook on its own, even for someone who never uses the AI tutor. The primary audience is the self-motivated learner who enjoys math, at any skill level.

Direction: pen-first and keyboard-free. The end state is an Android app on an e-ink tablet (BOOX in mind), with the web app in a thin shell plus the tablet's pen SDK, and no laptop needed. The shell waits until there is a device to test on; until then, check that every feature works pen-only at tablet size. See `docs/pen-first-math-workbook-plan.md`.

Work top to bottom unless priorities change. Every change goes through a branch and a PR (see CLAUDE.md, "Workflow and CI").

Done: autosave on the main page, the 5-second request limit, CI on every PR, thinner default pen.

## MVP

### 1. Handwriting test set

- Pages of real handwriting (written on a Wacom in the app) with a LaTeX answer key, kept outside the repo.
- A script sends each page to every configured model and scores the transcription against the key, so we know which models read handwritten math well enough before building on recognition.

### 2. Problem history

- A record of every problem worked: free-form boards, workbook exercises and Shelf items in one place.
- Replaces the small **Load** popup with a grid. Thumbnails are already saved with every session (`canvasImageBlob`) but never shown.
- Search, rename, sort, and filter by solved.

### 3. PDF Shelf

- Drop in PDFs (books, MOOC assignments). They land on a Shelf.
- Mark exercises as you read (a book) or all at once (an assignment); each opens on its own board beside the page. Single problems drop straight onto a board.
- No AI needed; works offline.

### 4. Export and auto-backup

- Export a page as PNG or PDF.
- Export and import every notebook as one file, and back up automatically to a folder the user picks (e.g. a Dropbox folder). No server or account.
- Ask the browser for persistent storage so IndexedDB isn't evicted.

### 5. Tutor memory

- A local, user-editable learner profile, summarized after each session and sent with tutor requests (not the raw history).
- Kept in app storage, so it moves with the app to the tablet.

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
