# TODO

Reviewed against the app on 2026-10-18.

Goal: make Math Tutor a great math notebook on its own, even for someone who never uses the AI tutor. The primary audience is the self-motivated learner who enjoys math, at any skill level.

Direction: pen-first and keyboard-free for the core reading, writing and tutor loop. The Android app is already built; the next hardware decision depends on testing the actual BOOX. It has **not arrived yet** (2026-10-18). Keep checking features with pen and taps at tablet size in the meantime.

Every change goes through a branch and a PR (see CLAUDE.md, "Workflow and CI"). The remaining items below carry forward the existing roadmap; priorities can change after the device test.

## Remaining work

### PDF reading and writing

- [ ] **Open as note:** move ink from a passage on a PDF page onto a new note board. Marking a passage as a note page already works.
- [ ] Edit a saved mark's box and label in the reader. Boards can already be renamed from the library; that does not edit the original mark's label or bounds.
- [ ] Dedicated PDF zoom controls beyond the current fit-to-width page and browser pinch zoom. The drawing board already has tldraw's zoom controls.
- [ ] Save a PDF with its page ink and highlights included. Board PNG/PDF export and full backups already exist.
- [ ] An optional default paper setting for new boards. Today each board remembers its paper; new Problems start Blank and Notes start Lined.

### Backup on the tablet

- [ ] Automatic backup to a folder or a sync-app location from the Android app. Desktop Chromium folder backup is built; Android currently saves a backup ZIP through its native Save dialog and can restore a chosen backup.

### Tutor and memory

- [ ] **Check me on this topic** for one topic or area straight from its row in Tutor memory. The multi-topic Skill check-in is built.
- [ ] Tutor-recommended problems based on Favorites and the learner profile. Starring a problem, recording why it was good and sharing favorites with the tutor are built.
- [ ] Design contextual tutor cards beside the selected passage or handwritten work, preserving useful feedback and follow-up context. The current tutor is a collapsible drawer with pen-friendly choices; replacing it remains a separate design step.

### Handwriting to TeX

- [ ] Include drawings as images in a write-up; they currently become `\fbox{Figure: …}` placeholders.
- [ ] Offer TeX write-up on boards opened from PDF marks. It is currently available on free boards through **Board → TeX write-up…**.

## BOOX validation — waiting for the device

- [ ] Test the actual app's small mathematical symbols, stroke latency, palm rejection, erasing, selection, undo, page movement and long reading sessions. The bare `/pen-test` page is available for comparison.
- [ ] Use those results to decide whether tldraw is suitable and whether a native pen layer / BOOX SDK integration is needed. Keep canvas-specific polish small until then.
- [ ] Try the installed Android app's tutor calls and Sign in with ChatGPT on the device, without a Mac.
- [ ] Test backup/restore on the device and choose its long-term backup location or sync workflow.
- [ ] Decide whether the pen panel should have fewer colors and no opacity for the monochrome screen.

## Later ideas

- [ ] Multi-page notebooks. tldraw supports pages, but each board currently has one.
- [ ] Continuous reading instead of only page-by-page navigation; design it first. Page ink, highlights and note boards are already built.
- [ ] Function plots on the canvas. Grid/graph paper is already built.
- [ ] **DRM-free EPUB as texts.** Reflow needs a different approach to marks, ink anchors and page references; math rendering also needs evaluation. DRM-locked books are outside this import path. The existing workaround is EPUB-to-PDF conversion, then **Add a PDF…**.
- [ ] A shared problem collection and recommendations from other learners. Personal Favorites already provide the "interesting problem" star.

## Delivered

### Home, folders and texts

**Home** is the library: Continue, nested folders, texts and free boards, with thumbnails, search, sorting, filters (including Favorites), Rename, Move to and Delete/Remove. **+ New** offers Problem, Notes, Add a PDF and, in the library, New folder. The main bar is Home, + New and Settings; the old Shelf tab is gone.

A PDF is a **text**, added or dropped into the library in a folder of its own. Its folder holds the text and its marked boards, and can contain more folders. Open the text from there to read at the saved page. Texts outside folders open directly in the reader. Search and filters find boards within folders and texts; deleting a folder moves its contents up a level.

### PDF reader and marked boards

Read with edge taps, sideways swipes, arrow keys, printed page numbers, Contents, margin trimming and full screen. **Your list**, **Contents** and **Search** organize and find exercises, note pages, highlights and page ink by section. The list can be hidden to give the page more room.

The compact text toolbar groups page arrows and drawing tools as named 44px icons, with Full screen and Your list icons, **Trim margins** in the Text menu, and direct **Mark** and **Ask** buttons.

**Mark** boxes an Exercise or Note, creates its board and keeps a mark on the PDF. An exercise picture is placed automatically on an empty board. Several marked exercises can share one PDF board (**This board** / **Own board**), with a current exercise and separate solved states. On an upright tablet, **Page N** / **Back to board** swaps between the page and board.

Pen, Highlight, Eraser and Undo work directly on PDF pages; ink is saved per page and included in backups. **Ask about the page** explains a boxed passage and **Save as note page** keeps the conversation on a note board. Exercise questions can include the preceding PDF text, limited to the exercise's page and at most 15 pages; the student can adjust or disable that context.

### Boards and tutor controls

- [x] Break down each reply's reported token usage into input, output and total across providers, with reasoning shown as part of output when reported.
- [x] Show how many input tokens were reused from cache when the provider reports it, including an explicit zero without adding cached tokens to the total again.
- [x] Keep ChatGPT's reference pages and current board ahead of changing memory/history to preserve reusable context; use only the automatic caching supported by the ChatGPT-plan connection.

Problem and Notes boards use tldraw, autosave, restore after reload, and start at pen size S / solid dash. Paper choices are Blank, Lined and Grid. **Add picture** accepts an image or a PDF's first page; **Put on board** places it behind the writing. This replaces the old Single problem flow.

The compact toolbar has Full screen, current Paper, sweep Clear, a Board menu, Favorite, Solved and one **Ask tutor** toggle. Board holds Hide drawing tools, PNG/PDF export and, on free boards, TeX write-up. **Show tools** restores hidden tools. Pen styles collapse behind a remembered color/size chip, opening the native controls on tap and closing on a stroke or Esc.

The tutor drawer's choices are Hint / Check my work / Feedback for Problems and Explain this / Check my notes for Notes, above the custom-question box and microphone. Opening/closing sends nothing and preserves drafts and active replies; hiding stops speech input, and reopening shows the latest reply. Every question carries a fresh board image, with readable close-ups for large boards; capture errors keep drafts. The five-second request interval and one-active-request limit apply across tutor calls.

On wide screens the PDF page and its board share the space beside the tutor, keeping the board's controls out of the conversation.

### Tutor memory and check-ins

**Tutor memory** holds About you, optional self-ratings, editable tutor topic notes, Favorites and the tutor's notebook. The tutor can update notes at the end of a reply when the work teaches it something; these are not automatic summaries of every session. The profile is kept locally, included in backups and shared with questions when enabled; the student can inspect what the tutor reads.

**Skill check-in** offers up to four uncertain topics, asks one problem at a time and records settled topics in memory. **Start check-in** requests the first problem; **Hand in answer** submits the board. **Show check-in problem** reopens a closed conversation without handing in an answer.

### Export, backup and Android app

**Board → Save as PNG / Save as PDF** exports a whole board. **Settings → Backup** downloads a ZIP of boards, texts, page ink, folders and tutor memory, and restores missing or newer work from a ZIP or folder. Desktop Chromium can automatically write to a chosen folder, keeping seven days of dated copies; **Backup paused** restores permission after a browser restart, and **Back up** reminds when a backup is due.

The Capacitor Android app is bundled and its APK built in CI. It calls tutor providers directly from the device, stores API keys with Android Keystore encryption, supports Sign in with ChatGPT, and uses the native Save dialog for downloads. Real-device validation remains above.

### Handwriting test and development checks

The Wacom pages and LaTeX keys live in `tests/handwriting/`; `npm run handwriting` transcribes and scores configured models. In the **2026-10-09** run, Claude Sonnet 5.5, Claude Opus 5.5 and ChatGPT-plan Sol 6.1 each scored 99% on written lines; Luna scored 91% and invented work, and Gemini 3.8 Flash's free tier was rate limited before completing the set. These are dated test results, not a new benchmark.

CI runs lint, typecheck, unit tests, production build and browser tests, plus the Android bundle tests and APK build. The app's shared visual language is ink on paper, with indigo reserved for tutor controls and feedback.

## Design references

- [Pen-first workbook direction](docs/pen-first-math-workbook-plan.md): historical product discussion; current implementation status is recorded here.
- [Library folders design](https://claude.ai/artifact/HwasY4HpAiE6Y5qNts1X6k), option B.
- [PDF reading design](https://claude.ai/artifact/TXw8zCKZbwQ9ohM2Fk9nC8), originally called the Shelf design.
