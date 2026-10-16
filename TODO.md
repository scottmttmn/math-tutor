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

Done: **Home** is the page the app opens on: a Continue card for the last board, then a grid of every free-form board and Shelf exercise that has work in it, with thumbnails, search, rename, sort, and filters (All / Problems / Notes / In progress / Solved). Every page has the same bar: Home, Shelf, + New, Settings.

- Later: more ways to organize problems and notes, probably folders.

### 3. PDF Shelf

Done: **Shelf** (in the bar) holds what you work from: PDFs of any kind (textbooks, problem sets, handouts) added or dropped in. Open one to read it page by page; **Mark exercise** and drag a box around a problem, and it opens on its own board beside the page (below it on an upright tablet), stays marked on the page (✓ once solved), and shows on Home. **Single problem** puts a picture or a PDF's first page straight onto a new board. Works offline; the tutor gets the marked region as the problem figure, plus the text of the book pages leading up to it (from the section's bookmark, at most 15 pages, never past the exercise; adjustable or off on the board).

Done: one look across the app: ink on paper, with only the tutor in color (**Ask tutor**, its drawer and replies), Solved as a filled ink check everywhere, kind icons on cards and in **+ New**, 44px controls, and Delete/Remove in a "⋯" menu.

Every board has the same layout: what it works from beside it (the problem or topic, the PDF page), which can be hidden, and the tutor as a drawer that opens when you ask. Every board has **Full screen** (in its toolbar), and a problem picture can be **put on the board**. **Hide tools** collapses the drawing tools, and the Shelf's list can be hidden so the page gets the full width.

Done (reading, step 1 of the [Shelf design](https://claude.ai/artifact/TXw8zCKZbwQ9ohM2Fk9nC8)): tap a page's edge, swipe sideways or use the arrow keys to turn it; tap the page number to go to a page by its printed number ("47", "xii"); **Contents** beside the page from the PDF's bookmarks; blank margins trimmed so the print is bigger (**Trim margins**, kept per book); **Full screen** for reading, where a tap in the middle hides and brings back the bars and **Book** opens the lists over the page.

- Done: ink on the page (pen, highlighter, eraser, undo), saved per page and in backups.
- Done: an exercise opened on an empty board is put on it; on an upright tablet the board takes the screen and swaps with the page (**Page 47** / **Back to board**).
- Done: note pages (**Mark** → Exercise or Note; a note opens on a lined Notes board), and **Your list**: the book's exercises, note pages, highlights (quoted) and ink by section, with solved counts. Boards have **Paper**: Blank, Lined or Grid.
- Not yet: **Open as note** (moving margin ink onto a new note page); the paper choice for new boards is per kind, not a setting.
- Done: **Search** in the book's list (results by section with a line of context; the words are lit on the page).
- Next, in this order: Ask about the page (an Ask button, then drag a box like Mark); Shelf cards with kind, progress and where you left off.
- Still to do: no zoom yet; marks can't be moved or renamed after saving.

### 4. Export and auto-backup

Done: **Save as…** on every board saves the whole board as a PNG or a one-page PDF. **Settings → Backup** downloads everything (every board, note and Shelf PDF) as one ZIP and restores it, or a backup folder, on any device; a restore only adds what is missing or newer. In Chrome on a computer, pick a folder (e.g. in Dropbox) and the app backs up there shortly after each change, with a dated copy per day for the last week; after a browser restart the bar shows **Backup paused** until you allow it again. The app asks the browser for persistent storage, and the bar suggests **Back up** when there is work with no backup from the last week.

- Still to do: on the BOOX (Android Chrome can't write to a folder) backup is the download; the Android shell can back up to a folder or a sync app instead.

### 5. Tutor memory

Done (step 1): **Tutor memory** (Settings → Tutor, or the line on Home while it's empty) holds **About you** and a self-assessment: topics by area, each rated Solid, Rusty, Learning or Never seen, plus topics of your own. It is sent with every question as information the tutor uses to pitch its hints (never as instructions), can be turned off, shows exactly what the tutor reads, and is in backups.

Done (step 2): the tutor notes what your boards show, per topic with a level and how sure it is, at the end of a reply and out of sight of the chat. The notes show under each topic on the Tutor memory page, where you can correct the level or forget the note, and the tutor reads them back with later questions.

- A local, user-editable learner profile, summarized after each session and sent with tutor requests (not the raw history).
- Kept in app storage, so it moves with the app to the tablet.
- **Self-assessment** (optional): pick topics and rate each one (solid, rusty, learning, never seen), plus a free-text "About me". This is the tutor's starting picture of the learner.
- Each topic in the profile has a level and how sure the tutor is of it. Everyday boards keep updating it, so one old answer never fixes a wrong picture in place.

### 6. Skill check-in

Done: **Skill check-in** on the Tutor memory page offers the topics nobody is sure about (rated Rusty or Learning, your own unrated ones, and ones the tutor noted without high confidence), up to 4. It opens a board where the tutor gives one short problem at a time, harder after a right answer and easier after a miss; you answer by hand and press Ask tutor, and each settled topic lands in the memory as a tutor note you can correct.

- Later: **Check me on this topic** for one topic or area straight from its row.

## After the MVP

- **Handwriting to TeX write-up.** Done (free boards): **TeX write-up** in the board's toolbar has the tutor transcribe the board (or the selected part) as LaTeX without solving anything; edit it beside a KaTeX preview and **Download .tex**. It saves with the board and goes in backups. Still to do: drawings come out as `\fbox{Figure: …}` placeholders rather than images; Shelf boards don't have the button yet.
- **Replace the chat pane.** Pen-only actions on a selection (Explain this, Give me a hint, Review my work), with replies as cards beside the work. The tutor waits until invited.
- **Android app** that needs no Mac (decided 2026-10-15). Done: the app bundled into an Android app (`android/`, Capacitor), APK built in CI; tutor calls from the device with API keys pasted into Settings and kept encrypted on the tablet; Sign in with ChatGPT on the device (allowed for a personal app that runs locally; still to try for real on the tablet). Next: BOOX pen SDK once the tablet is here; backup to a folder.

## Later

- Multi-page notebooks (tldraw supports pages; they're turned off today).
- Notes and highlights on Shelf pages, and reading without flipping page by page (to be designed first).
- Graph paper background and function plots on the canvas.

## Down the road (not now)

- Mark a problem as **interesting**. A star on saved problems is cheap once problem history exists.
- Eventually: a crowdsourced network of problems. Solve one, mark it interesting, and get recommendations for others.
