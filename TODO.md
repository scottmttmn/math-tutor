# TODO

Reviewed against the app on 2026-11-15.

Goal: a great math notebook on its own, even for someone who never uses the AI tutor. The audience is the self-motivated learner who enjoys math, at any level.

Designed around the tablet: the Android app on a BOOX Go 10.3 (black and white e-ink, pen first, often offline), with BOOX Notes as the reference for the notebook. The computer version follows the tablet, not the other way round.

Every change goes through a branch and a PR (see CLAUDE.md, "Workflow and CI"). How each feature works is described in CLAUDE.md; this file is only the order of work.

## Order of work (agreed 2026-11-15)

1. **Settle it.** No new features until the app holds up through long sessions.
2. **Close the loop.** Bring recorded work back to the learner, on Home.
3. **Notebook depth**, only as use shows it is missed.
4. **Not now**: see the end of this file.

## 1. Settle it

- [ ] **App kills on the tablet.** Every exit in the 2026-11-13 log was the app killed while in front, with no reason from Android. The memory work (pictures stored apart from boards, light autosave, backup reading only changed boards, PDFs read in parts) is in, but not yet confirmed on the device. Needed: a Settings → Errors log after a kill on a current build ("Last noted … before" says what was open). If kills continue, next is folder backup, which still rewrites all of a board's pictures into its file on each change (backup version 3: pictures as their own files).
- [x] When the page's process dies, the app starts its page again at Home instead of closing (a second loss within a minute still closes it). Not yet seen on the device.
- [x] **Board → Pinch to zoom**, a device choice: off, two fingers only scroll.
- [ ] Marking an exercise in a PDF and naming it takes too many steps; look for fewer.
- [ ] Notebooks whose pages were widened by writing at the edge (before 2026-11-15) stay wide. Offer a way to bring one back to the normal width if it bothers.
- [ ] ChatGPT-plan replies arrive whole on the tablet, not streamed (requests go through the native HTTP path). Stream them natively.
- [ ] Tutor reply text reads a little small on the tablet.
- [ ] Long-session check on the device: erasing, lasso, undo, page turns and reading for an hour or more without lag building up.
- [ ] Decide whether the pen's ink choices should be fewer on the monochrome screen.

## 2. Close the loop

The app records solved and unfinished problems, the tutor's second-look flags, favorites and topic notes. Home only lists them. Everything here shows on Home or in Tutor memory, never on the board (Scott: not distracting). Design as a mockup first.

- [ ] **Pick up** on Home: a short section with flagged problems to look at again, unfinished ones, and a rusty topic to try.
- [ ] Each quiet read becomes a tutor note on its topic, and notes record how much help a topic took.
- [ ] Scoring a flag (It was a mistake / It was fine; Was actually wrong for a miss), to compare models.
- [ ] **Another like this** on a board (a new board with a similar problem), then a typeset copy of a tutor's problem to **Put on board**.
- [ ] **Check me on this topic** from one topic's row in Tutor memory. The multi-topic check-in is built.

## 3. Notebook depth

- [ ] Marked problems listed under their book and section (a notebook tied to a text).
- [ ] Straightening lines (ink board step 8).
- [ ] **Open as note:** move ink from a passage on a PDF page onto a new note board.
- [ ] Redrawing a saved mark's box on a PDF page.
- [ ] An optional default paper for new boards. Today Problems start Blank and Notes start Lined.
- [ ] PDF zoom controls beyond fit to width.
- [ ] Save a PDF with its page ink and highlights included.
- [ ] Continuous reading instead of page by page; design it first.
- [ ] TeX write-up: drawings as images (now `\fbox{Figure: …}`), and on boards opened from PDF marks.
- [ ] Contextual tutor cards beside the selected work, as a design step. The lasso's Hint · Check already asks about a selection.

## 4. Not now

- A new name for the app.
- DRM-free EPUB as texts. Reflow needs a different approach to marks, ink anchors and page references. The workaround is converting to PDF.
- Typed boards (discussed 2026-10-21): a Typed kind beside Problem and Notes with visual math entry. It pulls against the keyboard-free direction.
- A shared problem collection and recommendations from other learners. It would be a separate project; the app is never hosted.
- Function plots on the board.
- Showing cache reuse on the ChatGPT-plan connection. Identical requests still reported zero cached tokens, and the connection rejects explicit cache controls.

## What is built

- **Notebook:** our own ink board (tldraw removed 2026-11-08) with Onyx's pen on BOOX, a left tool rail, whole-stroke eraser, scratch out to erase, lasso (move, resize, copy and paste, ask the tutor about a selection), pictures, paper, PNG/PDF export. Notes boards have pages you flip, and **Mark problem** names a problem in them.
- **Library:** Home with Continue, nested folders, texts and boards, search, filters and sorting. A PDF comes in a folder of its own.
- **PDF reader:** page turns, Contents, Search, Your list, trim margins, full screen, ink and highlights on pages, Mark for exercises and note pages (several exercises on one board, names from the book's numbering), Select to copy onto a board or ask about a passage.
- **Tutor:** a drawer you call (Hint, Check my work, Feedback; Explain this, Check my notes), run on principles; tutor memory with self-ratings, topic notes, a notebook and favorites; skill check-ins; Problem from tutor; quiet checks of work marked solved, shown only on Home; TeX write-up.
- **Tablet app:** standalone Android app with tutor calls and Sign in with ChatGPT on the device, encrypted API keys, in-app updates, an error log, and folder backup through Android's folder picker.
- **Backup:** ZIP download and restore, folder backup with seven days of dated copies.
- **Checks:** lint, type check, unit and browser tests and the Android build in CI; a handwriting test for comparing models (`npm run handwriting`).

## Design references

- [Ink board plan](https://claude.ai/artifact/WgrS9kXhB83B9ardHWxd1Q)
- [Library folders design](https://claude.ai/artifact/HwasY4HpAiE6Y5qNts1X6k), option B
- [PDF reading design](https://claude.ai/artifact/TXw8zCKZbwQ9ohM2Fk9nC8)
- [Quiet checks design](https://claude.ai/artifact/4w9ePv1YFruwonM2JMpXfV)
- [Pen-first workbook direction](docs/pen-first-math-workbook-plan.md): historical.
