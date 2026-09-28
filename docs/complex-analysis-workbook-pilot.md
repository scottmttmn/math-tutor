# Complex Analysis workbook pilot

## Goal

Turn a small part of Howell and Mathews's *Complex Analysis* into a self-paced book with a tutor embedded in the reading experience and a separate whiteboard for each problem. A reader can ask questions about the text while reading, work an exercise, ask about their own work, leave, and resume later.

The tutor never supplies a complete exercise solution. This pilot tests whether reading support plus persistent problem workspaces make the book more useful for independent study. It can begin with the existing whiteboard while its larger design questions are resolved later.

## Source and scope

- Book: [Howell and Mathews, *Complex Analysis*](https://complexanalysis.org/).
- Pilot section: [1.3, The Geometry of Complex Numbers, Part I](https://complexanalysis.org/web/sec_geometry-1.html). It combines calculation, explanation, and plotting in the complex plane.
- Start with a small, editorially recommended set of exercises; keep every exercise in the section available to work. Do not imply every exercise is required.
- Candidate set from section 1.3: Exercise 1(a) for a short calculation, 2(a) for vector plotting, 6(a) for sketching a locus, and 8 for a short explanation/proof. This mix tests several forms of tutor feedback without requiring many problems.
- Preserve a link from each adapted exercise to its original section and exercise number.
- The book site states a [CC BY 4.0 license](https://complexanalysis.org/). Record author, source URL, license link, and changes on each adapted content view. Review any separately credited figure or asset before copying it.

## Reader flow

1. Open the section in an in-app reader. The full section is navigable, with attribution and a link to the original.
2. Ask the tutor about a definition, proof step, example, or selected passage while reading. The tutor can explain the text directly.
3. Open any exercise. The exercise gets its own whiteboard and tutor conversation, with recommended exercises identified in the list.
4. Work, request feedback, and continue. The tutor knows the section and exercise, and sees the submitted whiteboard image. It gives hints or questions about the work but never a complete solution.
5. Leave and return to the same exercise with whiteboard work and conversation restored automatically. Reading questions remain in the section conversation.
6. Mark an attempt complete; additional exercises remain optional.

## Tutor behavior

- Reading context: explain terms, notation, examples, and arguments in the book. Use the current passage or section as context when available.
- Exercise context: respond to the student's partial work with diagnostics and hints, preserving the existing Socratic constraint.
- If a reading question asks for the answer to a current exercise, guide the student without providing the solution. Keep exercise solutions from the source book out of tutor context and out of the adapted reading view.
- Keep the reading conversation separate from each exercise conversation so the tutor can distinguish explanation of the text from work on a particular problem.

## First implementation slice

- Static catalog for one section and its exercises, with stable source IDs and attribution metadata. The first recommended set can be authored by hand.
- In-app section reader with reading questions and a linked exercise list. Exclude source-book exercise solutions from the adapted content.
- Exercise view with a separate whiteboard and conversation per problem, and a return path to the reading position.
- Autosave reading and exercise state to IndexedDB using stable workbook session IDs; retain existing free-form sessions. Save the active exercise and reading scroll position locally.
- Include reading or exercise context in tutor requests while preserving streaming responses and the existing free-form Problem/Notes modes.
- Reuse the existing canvas and drawing tools for the pilot's exercise whiteboards.

## Help cadence

Reading questions bypass the current five-minute wait. Requests that submit new whiteboard work retain the existing wait for this pilot. Text follow-ups within an exercise conversation remain available while the student works.

## Pilot acceptance check

A reader can read section 1.3 in the app, ask a question about the text, open any exercise, make marks on its whiteboard, receive a useful hint about that work, close the page, and return later to both conversations and the whiteboard. The tutor never reveals a full exercise solution. Source and adaptation credit are visible where book content appears.
