# Pen-first math workbook direction

Recorded September 28, 2026, from the product discussion with Scott.

## Intended experience

A focused math book that the learner can write in, with a tutor available when invited. Reading, writing equations, drawing diagrams, and revising an argument should feel like one activity. The core learning flow should work with a pen and taps, without requiring a keyboard.

The eventual target is a writing tablet with few distractions, potentially an e-ink device such as BOOX. A laptop remains useful for development and testing, but its interaction patterns should not determine the learning experience. Purchasing hardware is deferred; this direction should shape design now.

## Direction agreed in the conversation

- Prefer tldraw's canvas over the current custom canvas. Integrate it into the main experience while preserving saved work and existing free-form Problem and Notes modes.
- Give the book and the learner's writing most of the screen. Use a small number of large, pen-friendly controls.
- Move away from a permanent chat pane. Tutor replies and questions should appear beside the relevant passage or work; useful feedback should remain accessible later.
- Let the learner deliberately choose when to request help and which passage or handwritten region to submit.
- Treat handwriting as valid input in its own right. The learner should not have to type a question or convert equations to text before receiving help.
- Keep keyboard input available as an alternative. Voice can be optional, but the complete flow should work silently.
- Favor readable monochrome styling, minimal animation, comfortable page navigation, and automatic saving.

These describe the intended product. The current workbook still has a chat pane and typed question fields; tldraw is currently an isolated spike at `/canvas-next`.

## Proposed book-note approach

Start with notes attached to passages and equations. The imported section already has stable source IDs that can anchor notes when the reading layout changes.

The proposed first version combines highlights with a tldraw area for handwritten notes and diagrams beside the selected passage; typed notes remain optional. Reopening a passage should restore its notes. The learner can explicitly submit the passage and selected notes for tutor review.

Drawing directly over reflowing book text remains a later possibility. Resizing, font changes, scrolling, and zoom can move the underlying text, so an overlay needs a reliable anchoring strategy. Preserve selectable text and accessible math when designing this feature.

## Tutor behavior

The tutor should decide whether a question, explanation, or hint would help, using the learner's actual work and previous exchanges. A clock is a poor measure of whether someone has engaged with a hint.

- Ask specific follow-up questions about the student's reasoning and accept handwritten or diagrammatic responses.
- Give a small hint when needed, leaving a meaningful mathematical step for the student.
- Consider how the student used earlier guidance before giving a more specific hint. Rephrase or diagnose confusion when that is more useful.
- Explain missing prerequisites or use a simpler analogous example when appropriate. Avoid a rigid demand to “try first” in every exchange.
- Preserve the exercise's central challenge. Track cumulative disclosure across the conversation: several individually modest hints can still spoon-feed a complete solution.
- Keep direct reading explanations and free-form Notes support, while applying exercise safeguards to exercise requests, including disguised requests made in reading mode.

These principles need further implementation and evaluation. Existing workbook context and hint policies provide a starting point; they do not establish a universal guarantee against solution leakage.

## Request safety: implemented

The former five-minute whiteboard cooldown has been replaced with a five-second minimum interval between request starts across reading, exercises, whiteboard reviews, free-form follow-ups, and the tldraw spike. Requests briefly disable controls without a visible countdown. A reply lasting longer than five seconds permits an immediate follow-up when it finishes.

The server allows one provider request at a time and rejects rapid calls before contacting the provider. Failed requests also consume the short interval to prevent retry bursts. Build, lint, 14 focused tests, workbook browser acceptance, and tldraw browser checks passed. See [verification results](complex-analysis-workbook-verification.md).

This controls bursts rather than imposing a dollar budget. The server gate currently operates within one process. A multi-instance deployment needs shared enforcement; a hard spending cap needs separate token or cost accounting.

## Suggested implementation sequence

1. **Integrate tldraw.** Connect it to exercise and free-form sessions, tutor image submission, exercise switching, completion, and reload persistence. Preserve existing saved strokes through a migration or compatibility path.
2. **Add passage-linked notes.** Persist highlights and notes against stable source IDs, with handwritten diagrams available alongside the reading.
3. **Complete the keyboard-free tutor loop.** Select a passage or work region, tap Explain / Hint / Review, read a concise tutor card, write a response, submit it, and revise. Keep feedback and conversation context recoverable as the chat pane is replaced.
4. **Validate on hardware when available.** Test the actual app before committing to a device-specific architecture. Adjust navigation and display behavior for e-ink, and determine whether browser inking is sufficient.

This is a proposed sequence, without a delivery schedule or hardware purchase commitment.

## Hardware questions to validate

BOOX is the first candidate discussed because its Android platform offers a route for the web app and a potential native application. Its openness also requires deliberate configuration to keep distractions low. Supernote and reMarkable were considered for focused reading and writing, but compatibility with our live interactive tutor matters when selecting a target.

Native note-taking performance does not prove that a browser-based tldraw canvas will feel good on the same device. Test small mathematical symbols, pen latency, palm rejection, erasing, selection, undo, page movement, and long reading sessions. If browser inking is insufficient, investigate a native pen layer using the [BOOX SDK's WebView inking example](https://github.com/onyx-intl/OnyxAndroidDemo).

Check [tldraw's production license requirements](https://tldraw.dev/community/license) before deployment. Hardware suitability and licensing remain planning considerations, not completed work.

## Acceptance goals for the next experience

- Read a passage, attach a handwritten note or diagram, leave, and resume with the passage and notes restored.
- Open an exercise, write an attempt, request feedback on chosen work, answer a tutor follow-up by writing, and revise without a keyboard.
- Switch exercises and return without mixing boards, notes, or tutor context. Immediate reload preserves recent work and attempt completion.
- Reopen useful tutor feedback from the relevant passage or work. Replacing the chat pane preserves the context needed for follow-up questions.
- Repeated hint requests, full-answer requests, and disguised exercise requests preserve meaningful student reasoning across the whole exchange.
- Short safety limits protect requests without dictating hint progression or obstructing normal follow-up exchanges.
- Existing free-form Problem and Notes sessions remain usable, including saved work and optional typed input.

Device-specific writing quality remains a separate acceptance check to perform on real hardware.
