// === Canvas Types ===

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  thickness: number;
  tool: 'pen' | 'eraser';
}

export interface SelectionRect {
  startX: number;
  startY: number;
  width: number;
  height: number;
}

export type DrawingTool = 'pen' | 'eraser' | 'select' | 'pan';

export interface ToolSettings {
  activeTool: DrawingTool;
  penColor: string;
  penThickness: number;
  eraserThickness: number;
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
  canvasStrokes: Stroke[];
  canvasImageBlob: Blob | null;
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  isSolved?: boolean;
  sessionType?: SessionType;
}

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
