import type { BoardProblem, Session, ShelfExercise } from '@/types';

/** The mark whose board a mark is on: its own, or the one it was added to (Mark → This board). */
export const boardMarkOf = (mark: Pick<ShelfExercise, 'id' | 'boardOf'>) => mark.boardOf ?? mark.id;

/** Whether two marks are worked on the same board. */
export const sameBoard = (a: Pick<ShelfExercise, 'id' | 'boardOf'>, b: Pick<ShelfExercise, 'id' | 'boardOf'>) => boardMarkOf(a) === boardMarkOf(b);

/**
 * How a mark's picture is tagged on its board, so each is put there once: the board's own mark keeps
 * the tag every board had before boards held several (`true`), an added one is tagged with its id.
 */
export const pictureKey = (mark: Pick<ShelfExercise, 'id' | 'boardOf'>): string | true => (mark.boardOf ? mark.id : true);

/** The problem being worked on: `current`, else the first. */
export const currentOf = (problems: BoardProblem[], current: string | null | undefined) =>
  problems.find((problem) => problem.id === current) ?? problems[0];

/** Whether a mark on a board is solved: its own entry on a board of several, else the board's. */
export function markSolved(session: Pick<Session, 'isSolved' | 'problems'> | undefined, markId: string) {
  if (!session) return false;
  return session.problems ? Boolean(session.problems.find((problem) => problem.id === markId)?.isSolved) : Boolean(session.isSolved);
}

/** A board of several is solved once all of them are. */
export const allSolved = (problems: BoardProblem[]) => problems.length > 0 && problems.every((problem) => problem.isSolved);

/** A board's name from its problems: their names in order ("Exercise 11, Exercise 12"). */
export const problemsTitle = (problems: BoardProblem[]) => problems.map((problem) => problem.label).join(', ').slice(0, 50);

/**
 * A board without one of its problems, the next one current if it was. Its work stays on the board.
 * A board with no entry for it is returned as it is.
 */
export function withoutProblem(session: Session, markId: string): Session {
  const problems = session.problems?.filter((problem) => problem.id !== markId);
  if (!session.problems || !problems || problems.length === session.problems.length || problems.length === 0) return session;
  const current = currentOf(problems, session.currentProblem);
  return {
    ...session, problems, currentProblem: current.id, title: problemsTitle(problems),
    problemStatement: current.problemStatement, problemImage: current.problemImage, isSolved: allSolved(problems),
  };
}
