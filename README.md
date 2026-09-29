# Math Tutor

A math tutor with a freehand canvas and an experimental textbook workbook.

## Run locally

```bash
npm install
npm run dev
```

Open the address printed by Next.js. The home screen has a **Workbook** link; the workbook is also at `/workbook`. Tutor responses require the API key for the provider selected in the app settings.

Run `npm run build` to verify a production build.

## Complex Analysis workbook pilot

The pilot adapts [Howell and Mathews, *Complex Analysis*, §1.3](https://complexanalysis.org/web/sec_geometry-1.html), which is published under [CC BY 4.0](https://complexanalysis.org/). It includes the in-app reading, all 25 section exercises, and a small recommended path. Each exercise has a separate whiteboard and tutor conversation. All tutor requests share a five-second safety interval, with one request at a time and no visible countdown. The tutor is instructed to give hints and explanations without complete exercise solutions; the source solutions are excluded from the imported content.

Progress is saved in the browser's IndexedDB. The current exercise and reading position are saved in local storage. See [the pilot plan](docs/complex-analysis-workbook-pilot.md) for scope and behavior.

See [the pen-first workbook direction](docs/pen-first-math-workbook-plan.md) for the intended writing-tablet experience, passage-linked notes, tutor interactions without a permanent chat pane, and proposed next steps.

To refresh the adapted section from its source:

```bash
curl -L https://complexanalysis.org/web/sec_geometry-1.html -o /tmp/complex-geometry.html
node scripts/import-complex-section.mjs /tmp/complex-geometry.html
```

The importer strips source exercise solutions and renders the book's math with KaTeX. Review the generated content and attribution before publishing a refreshed import.

## Workbook verification

```bash
npm run lint
npm run test:workbook
npm run build
npx playwright install chromium
```

Start the built app in a separate terminal:

```bash
npm run start -- --hostname 127.0.0.1 --port 3100
```

Then run `npm run test:workbook:e2e`. Set `WORKBOOK_TEST_URL` to test another local address, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium installation. The browser test uses a temporary profile and a local mock model provider; it exercises the real tutor API and streaming client without using API credits or changing your saved progress. The focused tests cover both Anthropic and OpenAI-compatible request policies and error streams.

The workbook uses a synchronous local recovery copy while IndexedDB saves are pending, including during reload or page close. Its eight diagrams are bundled locally. Equation links return to their passage in the reading, and exercise credits link to the original exercise. Workbook tutor requests resolve section and exercise material on the server; the reading tutor receives the exercise catalog so quoted problems cannot bypass the hint policy by being called examples.

See [verification results](docs/complex-analysis-workbook-verification.md) for the acceptance checks and live tutor observations.
