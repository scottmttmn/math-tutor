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
  /** Set on a skill check-in board: the tutor poses problems on these topics instead of helping with one. */
  checkIn?: CheckIn;
  /** The board's TeX write-up: a LaTeX document body, converted from the handwriting and edited by the student. */
  writeUp?: WriteUp;
}

export interface WriteUp {
  /** The body of a LaTeX document (no preamble); see texDocument for the downloadable file. */
  tex: string;
  updatedAt: number;
}

/** A skill check-in: short problems on a few topics, answered by hand, that settle each topic's level in the tutor memory. */
export interface CheckIn {
  /** Topic names, as in the tutor memory. */
  topics: string[];
}

/** One entry in History: a free-form board, or a Shelf exercise with work in it. */
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
  /** Where it was worked on: a free-form board, or an exercise marked on the Shelf. */
  source: 'board' | 'shelf';
  /** Where a Shelf entry opens; free-form boards open in place. */
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
  /** False when the student turned off trimming the pages' blank margins. Unset: trimmed. */
  trimMargins?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What writes on a Shelf page: the pen, the highlighter, or the eraser (which removes whole strokes). */
export type InkTool = 'pen' | 'highlighter' | 'eraser';

/**
 * One stroke on a Shelf page. `points` is flat: x, y (fractions of the whole page, as marks are)
 * and the pen's pressure (0 to 1), for each sample.
 */
export interface InkStroke {
  tool: 'pen' | 'highlighter';
  points: number[];
}

/** The ink written on one page of a Shelf PDF; its id is `<document id>:<page>`. The PDF is never changed. */
export interface PageInk {
  id: string;
  documentId: string;
  /** 1-based page number. */
  page: number;
  strokes: InkStroke[];
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

/** One piece of the latest help request as the tutor route builds it: a label or question, or a PNG (base64). */
export type UserPart = { type: 'text'; text: string } | { type: 'image'; data: string };

/** What a choice under Ask tutor asks for (see askChoices in src/lib/tutorAsk.ts). */
export type TutorIntent = 'hint' | 'explain' | 'check' | 'feedback';

export interface TutorRequest {
  problemStatement: string;
  chatHistory: ChatMessage[];
  canvasImage: string;
  modelConfig: ModelConfig;
  userQuestion?: string;
  problemImage?: string;
  sessionType?: SessionType;
  bookContext?: BookContext;
  /** The student's tutor memory as text (see profileForTutor); absent when empty or not shared. */
  learnerProfile?: string;
  /** The tutor may end its reply with notes on topics for the tutor memory (see NOTES_RULE in tutorPrompt.ts). */
  takeNotes?: boolean;
  /** On a check-in board: the topics it covers (see CHECK_IN_PROMPT in tutorPrompt.ts). */
  checkIn?: CheckIn;
  /** Turn the board's handwriting into a LaTeX write-up (WRITE_UP_PROMPT) instead of tutoring. */
  writeUp?: boolean;
}

/** One request as the model gets it (planTutorRequest in src/lib/tutorPrompt.ts), for any provider. */
export interface TutorPlan {
  systemPrompt: string;
  /** The conversation's first user text (learner profile, book pages, check-in topics), or ''. */
  preface: string;
  history: Pick<ChatMessage, 'role' | 'content'>[];
  /** The latest user turn: labelled images and the question. */
  latest: UserPart[];
  maxTokens: number;
  isWriteUp: boolean;
}

/** Where a provider's API key comes from, for its error messages: the server's .env.local or the tablet's Settings. */
export type ApiKeySource = 'server' | 'device';

/** Which saved API key a provider uses in the Android app (see DeviceKeysPlugin). */
export type DeviceKeyName = 'anthropic' | 'gemini' | 'openai';

/** Text of the Shelf pages leading up to an exercise (never past its page), for the tutor to read. */
export interface BookContext {
  title: string;
  /** The bookmark the pages fall under, when the PDF has bookmarks. */
  section?: string;
  fromPage: number;
  toPage: number;
  text: string;
}

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
  /** The student's own rating. Null for a topic they added and haven't rated, or one only the tutor has noted. */
  rating: TopicRating | null;
  /** What the tutor made of the student's work on this topic, from their boards; the student can change or forget it. */
  tutor?: TutorNote;
}

export type TutorConfidence = 'low' | 'medium' | 'high';

/** The tutor's latest read of one topic. A newer board replaces it, so one old answer never fixes the picture. */
export interface TutorNote {
  level: TopicRating;
  confidence: TutorConfidence;
  /** One short line on what the work showed. */
  note: string;
  updatedAt: number;
  /** The student set the level themselves. */
  edited?: boolean;
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
  /** Ink on Shelf pages; missing in backups made before it existed. */
  ink?: PageInk[];
}

/** What a restore did: records added or updated, and those left alone because this device's copy is as new. */
export interface RestoreResult {
  restoredSessions: number;
  restoredShelf: number;
  /** The tutor memory was newer in the backup and replaced this device's. */
  restoredProfile: boolean;
  /** Pages of Shelf ink added or updated. */
  restoredInk: number;
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

/** The Android app's native Save dialog (android/…/SaveFilePlugin.java); data is base64. */
export interface SaveFilePlugin {
  save(options: { name: string; mimeType: string; data: string }): Promise<{ saved: boolean }>;
}

/**
 * The Android app's API keys (android/…/DeviceKeysPlugin.java): kept in the app's private storage,
 * encrypted with a key in the Android Keystore, and left out of Android's backups.
 */
export interface DeviceKeysPlugin {
  get(options: { name: DeviceKeyName }): Promise<{ value?: string }>;
  set(options: { name: DeviceKeyName; value: string }): Promise<void>;
  remove(options: { name: DeviceKeyName }): Promise<void>;
}
