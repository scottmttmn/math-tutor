import type { TLStoreSnapshot } from 'tldraw';

// === Canvas Types ===

/** A tldraw document (shapes, pages, schema) as saved with a session. */
export type CanvasDocument = TLStoreSnapshot;

/** A point of a legacy stroke, from before the canvas moved to tldraw. */
export interface Point {
  x: number;
  y: number;
}

/** A stroke drawn on the pre-tldraw canvas. Only read when loading old sessions. */
export interface Stroke {
  points: Point[];
  color: string;
  thickness: number;
  tool: 'pen' | 'eraser';
}

// === Chat Types ===

export type ChatRole = 'user' | 'assistant';

/** Tokens one tutor answer used, as reported by the provider. Only the ChatGPT plan path reports it today. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  imagePreview?: string;
  pending?: boolean;
  usage?: TokenUsage;
}

// === Session Types ===

export type SessionType = 'problem' | 'note';

export interface Session {
  id: string;
  title: string;
  problemStatement: string;
  problemImage: string | null;
  /** Legacy drawing; new saves leave it empty and use canvasDocument. */
  canvasStrokes: Stroke[];
  canvasDocument?: CanvasDocument | null;
  canvasImageBlob: Blob | null;
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  isSolved?: boolean;
  sessionType?: SessionType;
}

/** Main-page autosave: nothing to save yet, writing, written, or the last write failed. */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SessionMetadata {
  id: string;
  title: string;
  problemStatement: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isSolved?: boolean;
  sessionType?: SessionType;
}

// === Model Config Types ===

export type Provider = 'anthropic' | 'openai-compatible' | 'chatgpt';

export interface ModelConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
}

// === Sign in with ChatGPT Types ===

export interface ChatGPTModelOption {
  slug: string;
  displayName: string;
}

/** What /api/chatgpt reports to the browser. Never carries tokens. */
export interface ChatGPTStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required';
  /** True when the user allowed this app to use their ChatGPT plan. */
  sharing: boolean;
  email?: string;
  models?: ChatGPTModelOption[];
  error?: string;
}

// === API Types ===

export interface TutorRequest {
  problemStatement: string;
  chatHistory: ChatMessage[];
  canvasImage: string;
  modelConfig: ModelConfig;
  userQuestion?: string;
  problemImage?: string;
  sessionType?: SessionType;
  workbookContext?: WorkbookContext;
}

export type WorkbookContext =
  | {
      kind: 'reading';
      sectionId: string;
      selectedPassage?: string;
    }
  | {
      kind: 'exercise';
      sectionId: string;
      exerciseId: string;
    };

export interface TutorStreamEvent {
  type: 'text_delta' | 'usage' | 'message_stop' | 'error';
  content?: string;
  usage?: TokenUsage;
  error?: string;
}
