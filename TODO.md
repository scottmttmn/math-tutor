# TODO

Goal: make Math Tutor a great math notebook on its own, even for someone who never uses the AI tutor. The primary audience is the self-motivated learner who enjoys math, at any skill level.

Ranked; work top to bottom unless priorities change.

## 1. Autosave on the main page

- Today the main page saves only when you click **Save**. A refresh loses the canvas and chat.
- Every save resets `createdAt` (`handleSave` in `src/components/layout/AppShell.tsx`).
- The workbook already autosaves (`src/lib/workbookStorage.ts`: a localStorage recovery copy plus a debounced IndexedDB save). Reuse that here and show a small "Saved" indicator.

## 2. Handwriting to TeX write-up

- Flow: work the problem by hand, write a neat version on its own board, then **Convert to TeX**.
- The result opens as an editable LaTeX document with the source next to a live preview (KaTeX is already a dependency), so misreadings can be fixed.
- Download the `.tex` file. Drawings that can't be TeX are exported as images and referenced from the document. Print the preview to PDF for a copy without a TeX install.
- Converting just a selection of ink in place is a smaller version of the same feature.
- Recognition needs a vision model (the provider configured in Settings, including local Ollama). It's a tool, not the tutor. Fully offline recognition is a later option.

## 3. Bring your own material

- Drop in PDFs, such as assignments from a MOOC. Each page becomes a locked background you can write on, or opens beside a fresh board per problem.
- No AI needed; works offline.
- Longer term: more openly licensed workbook sections at different levels (today there is one section of one book).

## 4. Notebook library

- Replace the small **Load** popup with a grid of saved notebooks.
- Thumbnails are already saved with every session (`canvasImageBlob`) but never shown.
- Search, rename, sort, and filter by solved.

## 5. Export and backup

- Export a page as PNG or PDF.
- Export and import every notebook as one file. All work currently lives only in one browser's IndexedDB.

## 6. Keep the AI out of the way

- For learners the tutor is a feature, so it doesn't need to be hidden. Make **Ask for Help** less prominent, and consider a setting that hides chat, the model label and the workbook's tutor panel.

## Later

- Multi-page notebooks (tldraw supports pages; they're turned off today).
- Highlights and margin notes in the workbook reader.
- Graph paper background and function plots on the canvas.

## Down the road (not now)

- Mark a problem as **interesting**. A star on saved problems is cheap once the library exists.
- Eventually: a crowdsourced network of problems. Solve one, mark it interesting, and get recommendations for others.
