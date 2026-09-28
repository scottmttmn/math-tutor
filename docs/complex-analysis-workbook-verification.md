# Complex Analysis workbook acceptance verification

Verified against the local production build on September 27–28, 2026.

## Concrete failures fixed

- Reloading immediately after drawing or marking an attempt complete lost the last changes during the 600 ms IndexedDB save delay. A synchronous recovery record now protects pending saves; page hide and route departure also flush IndexedDB. An older save cannot clear a newer recovery record.
- Exercise requests carried only a section title, source URL, and problem statement. Both workbook modes now resolve the canonical section on the server; exercise requests include its reading text and the current exercise. Unknown sections, modes, and exercise IDs return 400.
- An exercise context with `sessionType: note` selected the permissive Notes policy. Workbook exercise context now takes priority over that field, while standalone Notes and Problem sessions keep their original policies.
- The reading tutor supplied the entire answer to Exercise 1(a) when it was requested as a worked example. Its authoritative context now includes all 25 exercise statements, with instructions to recognize quoted/paraphrased problems and use hints. The original live bypass and explicit answer requests were rechecked successfully.
- Source figures depended on remote image requests and were absent in the baseline browser view. All eight book diagrams now load from local SVG files with alternative text and attribution.
- Equation links opened the source site, and converting math to KaTeX discarded equation IDs. Imports now preserve IDs and use local references. Clicking an exercise's equation reference returns to that exact reading passage.
- An imported lower-bound inequality, the nested square root in Exercise 18, and Exercise 4(b)'s identity reference were incorrect in the source. The importer corrects them, and adaptation credit names these corrections.
- Canvas selection survived changing exercises; whiteboard review ignored the selection. Restoring a board now clears selection and undo/redo history, and review sends the selected region when present. Workbook keyboard shortcuts also match the toolbar's labels.
- Independent cooldown hooks could show inconsistent button states until the next timer tick. Successful reviews now notify all hooks immediately; reading and exercise text questions continue to bypass the review cooldown.
- Follow-up streaming errors reported success, abrupt streams could silently leave partial replies, and Anthropic error/end handlers could close a stream twice. The shared client now handles both request types consistently, detects interrupted streams, and cancels on unmount. Both provider streams close once and cancel upstream requests on disconnect.
- Reloading during a response could restore an empty assistant message as a permanent typing indicator. Pending replies now restore with an interruption notice and can be retried.
- Initial load failures had no recovery action. The workbook now offers a load retry without overwriting saved work.
- The completion control implied a correctness judgment. Workbook attempts now use “Mark attempt complete” and “Attempt complete,” while free-form problems retain “Mark Solved.”
- Lint scanned a nested Claude worktree and failed on existing synchronous effect updates. Nested worktrees are excluded; model settings, speech support, and dictated input synchronize without those effects. A dictated final result arriving after Send cannot repopulate the cleared input. The production tracing root is explicit. A later dev-server check also required an explicit `turbopack.root` tied to the config directory and clearing the generated `.next/dev` cache, whose PostCSS worker retained the parent-directory root.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm run build` | Passed, including TypeScript and prerendering `/` and `/workbook` |
| `npm run lint` | Passed |
| `npm run dev` (Turbopack) | Fresh compilation of `/workbook` and `/` returned 200; Tailwind styles, diagrams, and controls rendered without browser errors |
| `npm run test:workbook` | Nine focused tests passed |
| Production and Turbopack dev browser acceptance | Reading, selection, all exercises/diagrams, context, review images, switching, immediate reload, browser restart, completion, cooldown, equation links, streaming failures, mobile controls, and free-form modes exercised |
| Live Anthropic reading request | Explained the geometric meaning of Re(z) using the section |
| Live Anthropic whiteboard review | Recognized a coordinate system and two student-drawn vectors; asked diagnostic questions without solving the exercise |
| Live reload | Restored the board, exercise conversation, completion state, and separate reading conversation |
| Live disguised calculation | Recognized Exercise 1(a) instead of computing its final value |
| Live Notes-mode override attempt | Exercise context retained the hint policy |
| Live selected-passage injection / disguised proof | Recognized Exercise 8 and declined to provide its complete proof |
| Live free-form modes | Notes directly explained the modulus of 3+4i; Problem mode declined a complete solution request |

The deterministic browser suite uses an isolated persistent browser profile and a local OpenAI-compatible mock provider behind the real application API. It checks the actual provider payload, uploaded PNG dimensions, SSE rendering, IndexedDB/local recovery, and mode-specific policies. Dictation is tested with a simulated SpeechRecognition implementation; physical microphone recognition is not part of this check. Live tutor observations above were made separately using Anthropic.

The solution policy is enforced through authoritative workbook context and model instructions. The tested bypasses no longer reveal full solutions; these checks do not establish a guarantee for every possible prompt or model.

## Reproduce

Run `npm run lint`, `npm run test:workbook`, and `npm run build`. Install the test browser with `npx playwright install chromium`, start `npm run start -- --hostname 127.0.0.1 --port 3100`, and run `npm run test:workbook:e2e` in another terminal. `WORKBOOK_TEST_URL` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can override the app address and browser executable.

## Dev-server follow-up

The reported `Can't resolve 'tailwindcss' in '/Users/scottmittman/Code'` error reproduced under Turbopack despite the production tracing-root setting. `next.config.ts` now sets both `outputFileTracingRoot` and `turbopack.root` to `__dirname`. The obsolete generated dev cache was archived under `/tmp` so the PostCSS worker could be regenerated with the correct root. The ten browser acceptance groups, nine focused tests, lint, and the production build all passed after this fix. Port 3000 belongs to a separate project; no change to that process was needed.
