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

export type DrawingTool = 'pen' | 'eraser' | 'select';

export interface ToolSettings {
  activeTool: DrawingTool;
  penColor: string;
  penThickness: number;
  eraserThickness: number;
}

// === Chat Types ===

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  imagePreview?: string;
}

// === Session Types ===

export interface Session {
  id: string;
  title: string;
  problemStatement: string;
  canvasStrokes: Stroke[];
  canvasImageBlob: Blob | null;
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionMetadata {
  id: string;
  title: string;
  problemStatement: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// === Model Config Types ===

export type Provider = 'anthropic' | 'openai-compatible';

export interface ModelConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
}

// === API Types ===

export interface TutorRequest {
  problemStatement: string;
  chatHistory: ChatMessage[];
  canvasImage: string;
  modelConfig: ModelConfig;
  userQuestion?: string;
}

export interface TutorStreamEvent {
  type: 'text_delta' | 'message_stop' | 'error';
  content?: string;
  error?: string;
}
