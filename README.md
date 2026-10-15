# Math Tutor

A math tutor with a freehand canvas, a Shelf for the PDFs you work from, and an AI tutor you call when you want help.

## Run locally

```bash
npm install
npm run dev
```

Open the address printed by Next.js. The app opens on Home; **+ New** starts a board and **Shelf** holds your PDFs. Tutor responses require the API key for the provider selected in the app settings.

Put the selected provider's key in `.env.local` and restart the server: `ANTHROPIC_API_KEY` for Anthropic, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) for Google Gemini, and `OPENAI_API_KEY` for other OpenAI-compatible services. The Gemini preset uses `gemini-3.8-flash`; switching to it does not reuse an OpenAI key.

Run `npm run build` to verify a production build.

Gemini quota failures automatically fall back from 3.8 Flash through 3.7, 3.6, 3.5 Flash, 3.5 Flash-Lite, and 3.1 Flash-Lite. Each model is tried at most once per question; daily quota failures are skipped until midnight Pacific, other quota failures for one minute (held in server memory). Replies identify the fallback model. Authentication errors and failures after text begins do not retry. The same tutor context, images, and five-second request safeguard apply throughout. Google's project-wide quotas can still limit all models; see your project's limits in AI Studio.

All tutor chat views render inline and display LaTeX with KaTeX (`\(…\)`, `\[…\]`, `$…$`, and `$$…$$`). Incomplete or invalid expressions remain visible as text while streaming; code spans stay literal.

See [the pen-first direction](docs/pen-first-math-workbook-plan.md) for the intended writing-tablet experience.

## Tests

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
```

Start the built app in a separate terminal:

```bash
npm run start -- --hostname 127.0.0.1 --port 3100
```

Then run `npm run test:e2e`. Set `APP_TEST_URL` to test another local address, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium installation. The browser tests use a temporary profile and a local mock model provider; they exercise the real tutor API and streaming client without using API credits or changing your saved work.
