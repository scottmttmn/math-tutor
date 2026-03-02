'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { ChatMessage, SessionMetadata } from '@/types';

type SessionAction =
  | { type: 'SET_PROBLEM'; text: string }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'APPEND_TO_LAST_MESSAGE'; content: string }
  | { type: 'SET_STREAMING'; streaming: boolean }
  | { type: 'LOAD_SESSION'; sessionId: string; problemStatement: string; chatHistory: ChatMessage[] }
  | { type: 'NEW_SESSION' }
  | { type: 'SET_SESSION_LIST'; sessions: SessionMetadata[] }
  | { type: 'SET_CURRENT_SESSION_ID'; id: string };

interface SessionState {
  currentSessionId: string | null;
  problemStatement: string;
  chatHistory: ChatMessage[];
  savedSessions: SessionMetadata[];
  isStreaming: boolean;
}

const initialState: SessionState = {
  currentSessionId: null,
  problemStatement: '',
  chatHistory: [],
  savedSessions: [],
  isStreaming: false,
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_PROBLEM':
      return { ...state, problemStatement: action.text };
    case 'ADD_MESSAGE':
      return { ...state, chatHistory: [...state.chatHistory, action.message] };
    case 'APPEND_TO_LAST_MESSAGE': {
      if (state.chatHistory.length === 0) return state;
      const updated = [...state.chatHistory];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = { ...last, content: last.content + action.content };
      return { ...state, chatHistory: updated };
    }
    case 'SET_STREAMING':
      return { ...state, isStreaming: action.streaming };
    case 'LOAD_SESSION':
      return {
        ...state,
        currentSessionId: action.sessionId,
        problemStatement: action.problemStatement,
        chatHistory: action.chatHistory,
      };
    case 'NEW_SESSION':
      return {
        ...state,
        currentSessionId: null,
        problemStatement: '',
        chatHistory: [],
      };
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
