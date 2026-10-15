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
  model?: string;
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
  /** A name the student gave it in History; otherwise the title comes from the problem. */
  customTitle?: string;
}

/** One entry in History: a free-form board, or a workbook or Shelf exercise (or reading) with work in it. */
export interface HistoryItem {
  id: string;
  title: string;
  problemStatement: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isSolved: boolean;
  sessionType: SessionType;
  renamed: boolean;
  thumbnail: Blob | null;
  /** Where it was worked on: a free-form board, the workbook, or an exercise marked on the Shelf. */
  source: 'board' | 'workbook' | 'shelf';
  /** Where a workbook or Shelf entry opens; free-form boards open in place. */
  href: string | null;
}

/** History's filter: everything, problems not yet solved, solved problems, or notes. */
export type HistoryShow = 'all' | 'problems' | 'notes' | 'inProgress' | 'solved';
export type HistorySort = 'updated' | 'created' | 'title';

// === Shelf ===

/** A region of a PDF page, as fractions (0 to 1) of the page's width and height. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An exercise marked on a Shelf PDF; its board is the session `shelf:<document id>:<exercise id>`. */
export interface ShelfExercise {
  id: string;
  label: string;
  /** 1-based page number. */
  page: number;
  rect: PageRect;
  createdAt: number;
  /** First page the tutor reads for this exercise, chosen by the student; 0 = none. Unset: worked out from the bookmarks. */
  readFrom?: number;
}

/** A PDF on the Shelf, with the exercises marked on it. */
export interface ShelfDocument {
  id: string;
  title: string;
  file: Blob;
  pageCount: number;
  /** First page, small, for the Shelf grid. */
  cover: Blob | null;
  /** The page the reader was last on (1-based). */
  lastPage: number;
  exercises: ShelfExercise[];
  createdAt: number;
  updatedAt: number;
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

/** POST /api/transcribe: one image read by the ChatGPT plan (used by the handwriting test). */
export interface TranscribeRequest {
  /** Base64 PNG without the data: prefix. */
  image: string;
  prompt: string;
  /** A plan model slug or loose name ("sol 6.1"); defaults to the app's default plan model. */
  model?: string;
}

export interface TranscribeResponse {
  text: string;
  model: string;
  /** True when the reply stopped before it finished. */
  cutOff: boolean;
}

export interface TutorRequest {
  problemStatement: string;
  chatHistory: ChatMessage[];
  canvasImage: string;
  modelConfig: ModelConfig;
  userQuestion?: string;
  problemImage?: string;
  sessionType?: SessionType;
  workbookContext?: WorkbookContext;
  bookContext?: BookContext;
  /** The student's tutor memory as text (see profileForTutor); absent when empty or not shared. */
  learnerProfile?: string;
}

/** Text of the Shelf pages leading up to an exercise (never past its page), for the tutor to read. */
export interface BookContext {
  title: string;
  /** The bookmark the pages fall under, when the PDF has bookmarks. */
  section?: string;
  fromPage: number;
  toPage: number;
  text: string;
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
  type: 'text_delta' | 'usage' | 'message_stop' | 'error' | 'model';
  model?: string;
  content?: string;
  usage?: TokenUsage;
  error?: string;
}

/** What /pen-test measured while the pen was down. */
export interface PenTestStats {
  /** Pen samples per second, coalesced ones included. */
  samplesPerSecond: number;
  /** Average time from a pen sample to the page handling it, in ms (screen refresh not included). */
  inputDelayMs: number;
  /** Longest gap between two handled events, in ms (a stall shows up here). */
  worstGapMs: number;
}

// === Tutor memory ===

/** How well the student says they know a topic. */
export type TopicRating = 'solid' | 'rusty' | 'learning' | 'never';

/** A topic the student rated (or added). Catalog topics keep their catalog id; added ones get their own. */
export interface ProfileTopic {
  id: string;
  name: string;
  area: string;
  /** Null only for a topic the student added and hasn't rated yet. */
  rating: TopicRating | null;
}

/** What the tutor knows about the student: kept on this device, edited by the student, sent with questions. */
export interface LearnerProfile {
  /** In the student's own words: what they study and why, how they like to be helped. */
  aboutMe: string;
  topics: ProfileTopic[];
  /** Off: nothing here goes to the tutor. */
  shareWithTutor: boolean;
  updatedAt: number;
}

// === Backup ===

/** A saved session in a backup: the thumbnail Blob as a data URL. */
export type BackupSession = Omit<Session, 'canvasImageBlob'> & { canvasImage: string | null };

/** A Shelf PDF in a backup: the cover as a data URL; the PDF itself is the file `pdfs/<id>.pdf`. */
export type BackupShelfDocument = Omit<ShelfDocument, 'file' | 'cover'> & { cover: string | null };

/** `backup.json`: everything the app keeps, apart from the Shelf's PDF files. */
export interface BackupManifest {
  app: 'math-tutor';
  version: 1;
  createdAt: number;
  sessions: BackupSession[];
  shelf: BackupShelfDocument[];
  /** Tutor memory; missing in backups made before it existed. */
  profile?: LearnerProfile;
}

/** What a restore did: records added or updated, and those left alone because this device's copy is as new. */
export interface RestoreResult {
  restoredSessions: number;
  restoredShelf: number;
  /** The tutor memory was newer in the backup and replaced this device's. */
  restoredProfile: boolean;
  skipped: number;
  /** Shelf PDFs listed in the backup whose file wasn't with it (and isn't on this device). */
  missingPdfs: string[];
}

/** Automatic backup to a folder, as the Backup settings and the top bar show it. */
export interface BackupStatus {
  /** False where the browser can't write to a folder (e.g. Android); downloads still work. */
  folderSupported: boolean;
  folderName: string | null;
  /** off: no folder chosen; paused: the browser needs permission again; writing; ok; error. */
  state: 'off' | 'ok' | 'paused' | 'writing' | 'error';
  lastBackupAt: number | null;
  lastDownloadAt: number | null;
  error: string | null;
  /** Whether the browser promised not to clear stored work; null until known or where it can't say. */
  persisted: boolean | null;
  /** Saved boards or Shelf PDFs exist, so there is something to lose. */
  hasWork: boolean;
}
