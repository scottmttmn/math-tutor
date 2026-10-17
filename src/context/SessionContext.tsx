'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import { currentOf } from '@/lib/boardProblems';
import type { BoardProblem, ChatMessage, CheckIn, Paper, SessionMetadata, SessionType, TokenUsage, WriteUp } from '@/types';

type SessionAction =
  | { type: 'SET_PROBLEM'; text: string }
  | { type: 'SET_PROBLEM_IMAGE'; image: string | null }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'APPEND_TO_LAST_MESSAGE'; content: string }
  | { type: 'SET_LAST_MESSAGE_USAGE'; usage: TokenUsage }
  | { type: 'SET_LAST_MESSAGE_MODEL'; model: string }
  | { type: 'SET_STREAMING'; streaming: boolean }
  | { type: 'LOAD_SESSION'; sessionId: string; problemStatement: string; chatHistory: ChatMessage[]; problemImage: string | null; isSolved?: boolean; sessionType?: SessionType; checkIn?: CheckIn; writeUp?: WriteUp; paper?: Paper; problems?: BoardProblem[]; currentProblem?: string }
  | { type: 'NEW_SESSION'; sessionType?: SessionType }
  | { type: 'SET_SESSION_LIST'; sessions: SessionMetadata[] }
  | { type: 'SET_CURRENT_SESSION_ID'; id: string }
  | { type: 'TOGGLE_SOLVED' }
  | { type: 'SET_WRITE_UP'; writeUp: WriteUp | null }
  | { type: 'SET_PAPER'; paper: Paper }
  // A board of several exercises: add one (the board's own becomes the first, named `first`) and work on it, or switch to one.
  | { type: 'ADD_PROBLEM'; problem: BoardProblem; first: Pick<BoardProblem, 'id' | 'label'> }
  | { type: 'SELECT_PROBLEM'; id: string }
  | { type: 'REMOVE_PROBLEM'; id: string };

interface SessionState {
  currentSessionId: string | null;
  problemStatement: string;
  problemImage: string | null;
  chatHistory: ChatMessage[];
  savedSessions: SessionMetadata[];
  isStreaming: boolean;
  isSolved: boolean;
  sessionType: SessionType;
  /** Set on a skill check-in board. */
  checkIn: CheckIn | null;
  /** The board's TeX write-up, once made. */
  writeUp: WriteUp | null;
  /** The paper chosen for this board; null: the default for its kind. */
  paper: Paper | null;
  /**
   * The exercises on a board that holds several, kept in step with the current one's problem,
   * picture and Solved (the fields above); null: one problem.
   */
  problems: BoardProblem[] | null;
  currentProblem: string | null;
}

export const initialState: SessionState = {
  currentSessionId: null,
  problemStatement: '',
  problemImage: null,
  chatHistory: [],
  savedSessions: [],
  isStreaming: false,
  isSolved: false,
  sessionType: 'problem',
  checkIn: null,
  writeUp: null,
  paper: null,
  problems: null,
  currentProblem: null,
};

// The current problem's entry, updated with the board's problem fields.
function synced(state: SessionState): SessionState {
  if (!state.problems) return state;
  return {
    ...state,
    problems: state.problems.map((problem) => (problem.id === state.currentProblem
      ? { ...problem, problemStatement: state.problemStatement, problemImage: state.problemImage, isSolved: state.isSolved }
      : problem)),
  };
}

// Works on one of the board's problems: its text, picture and Solved become the board's.
function select(state: SessionState, problems: BoardProblem[], id: string | null | undefined): SessionState {
  const current = currentOf(problems, id);
  if (!current) return state;
  return {
    ...state, problems, currentProblem: current.id,
    problemStatement: current.problemStatement, problemImage: current.problemImage, isSolved: Boolean(current.isSolved),
  };
}

// Exported for the unit tests.
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_PROBLEM':
      return synced({ ...state, problemStatement: action.text });
    case 'SET_PROBLEM_IMAGE':
      return synced({ ...state, problemImage: action.image });
    case 'ADD_MESSAGE':
      return { ...state, chatHistory: [...state.chatHistory, action.message] };
    case 'APPEND_TO_LAST_MESSAGE': {
      if (state.chatHistory.length === 0) return state;
      const updated = [...state.chatHistory];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = { ...last, content: last.content + action.content };
      return { ...state, chatHistory: updated };
    }
    case 'SET_LAST_MESSAGE_USAGE': {
      if (state.chatHistory.length === 0) return state;
      const updated = [...state.chatHistory];
      updated[updated.length - 1] = { ...updated[updated.length - 1], usage: action.usage };
      return { ...state, chatHistory: updated };
    }
    case 'SET_STREAMING':
      return {
        ...state,
        isStreaming: action.streaming,
        chatHistory: action.streaming ? state.chatHistory : state.chatHistory.map((message) =>
          message.pending ? { ...message, pending: false } : message),
      };
    case 'SET_LAST_MESSAGE_MODEL':
      return { ...state, chatHistory: state.chatHistory.map((message, index) =>
        index === state.chatHistory.length - 1 ? { ...message, model: action.model } : message) };
    case 'LOAD_SESSION': {
      const loaded: SessionState = {
        ...state,
        currentSessionId: action.sessionId,
        problemStatement: action.problemStatement,
        problemImage: action.problemImage,
        chatHistory: action.chatHistory,
        isSolved: !!action.isSolved,
        sessionType: action.sessionType ?? 'problem',
        checkIn: action.checkIn ?? null,
        writeUp: action.writeUp ?? null,
        paper: action.paper ?? null,
        problems: null,
        currentProblem: null,
      };
      return action.problems?.length ? select(loaded, action.problems, action.currentProblem) : loaded;
    }
    case 'NEW_SESSION':
      return {
        ...state,
        currentSessionId: null,
        problemStatement: '',
        problemImage: null,
        chatHistory: [],
        isSolved: false,
        sessionType: action.sessionType ?? 'problem',
        checkIn: null,
        writeUp: null,
        paper: null,
        problems: null,
        currentProblem: null,
      };
    case 'TOGGLE_SOLVED':
      return synced({ ...state, isSolved: !state.isSolved });
    case 'ADD_PROBLEM': {
      const own: BoardProblem = {
        id: action.first.id, label: action.first.label, problemStatement: state.problemStatement, problemImage: state.problemImage, isSolved: state.isSolved,
      };
      const problems = synced(state).problems ?? [own];
      return select(state, [...problems.filter((problem) => problem.id !== action.problem.id), action.problem], action.problem.id);
    }
    case 'SELECT_PROBLEM': {
      const problems = synced(state).problems;
      return problems ? select(state, problems, action.id) : state;
    }
    case 'REMOVE_PROBLEM': {
      const problems = synced(state).problems?.filter((problem) => problem.id !== action.id);
      if (!problems?.length) return state;
      return select(state, problems, state.currentProblem === action.id ? problems[0].id : state.currentProblem);
    }
    case 'SET_WRITE_UP':
      return { ...state, writeUp: action.writeUp };
    case 'SET_PAPER':
      return { ...state, paper: action.paper };
    case 'SET_SESSION_LIST':
      return { ...state, savedSessions: action.sessions };
    case 'SET_CURRENT_SESSION_ID':
      return { ...state, currentSessionId: action.id };
    default:
      return state;
  }
}

const SessionStateContext = createContext<SessionState>(initialState);
const SessionDispatchContext = createContext<Dispatch<SessionAction>>(() => {});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  return (
    <SessionStateContext.Provider value={state}>
      <SessionDispatchContext.Provider value={dispatch}>
        {children}
      </SessionDispatchContext.Provider>
    </SessionStateContext.Provider>
  );
}

export function useSessionState() {
  return useContext(SessionStateContext);
}

export function useSessionDispatch() {
  return useContext(SessionDispatchContext);
}
