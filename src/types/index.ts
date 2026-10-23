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

/** An ink board's colors: the tablet offers black and gray, the computer all of them. */
export type InkColor = 'black' | 'gray' | 'blue' | 'red' | 'green';

/** A stroke on an ink board, in board units (CSS px at writing scale). */
export interface BoardStroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: InkColor;
  /** Width at medium pressure; the pen's varies with pressure, the highlighter's doesn't. */
  width: number;
  /** Flat [x, y, pressure, …], pressure 0–1. */
  points: number[];
}

/** A picture on an ink board: the problem (locked, placed once) or one kept from an old board. */
export interface BoardImage {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A data URL. */
  src: string;
  /** The problem picture: `true` for the board's own, an exercise's id for one added to a board of several. */
  problem?: string | true;
}

/** The ink board's page: a fixed width from `left`, a top edge, and no bottom. */
export interface BoardPage {
  left: number;
  top: number;
  width: number;
}

/** An ink board's drawing as saved with a session. Strokes are in drawing order; images sit under them. */
export interface BoardInk {
  version: 1;
  page: BoardPage;
  strokes: BoardStroke[];
  images: BoardImage[];
}

// === Chat Types ===

export type ChatRole = 'user' | 'assistant';

/** Tokens one tutor request used, as reported by its provider (including cached input). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Part of inputTokens reused from cache, not cache writes. Omitted when not reported. */
  cachedInputTokens?: number;
  /** Part of outputTokens, not additional tokens. Omitted when the provider does not report it. */
  reasoningTokens?: number;
  /** Older saved usage came only from the ChatGPT plan. */
  provider?: Provider;
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

/** The paper a board is drawn on. Unset: lined for notes, blank for problems (`paperFor`). */
export type Paper = 'blank' | 'grid' | 'lined';

export interface Session {
  id: string;
  title: string;
  problemStatement: string;
  problemImage: string | null;
  /** Legacy drawing; new saves leave it empty and use canvasDocument. */
  canvasStrokes: Stroke[];
  canvasDocument?: CanvasDocument | null;
  /** The drawing of a board on the ink board (replacing tldraw); a session has this or `canvasDocument`. */
  ink?: BoardInk | null;
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
  /** The paper the student chose for this board; unset until they choose. */
  paper?: Paper;
  /** Set on a board whose problem the tutor wrote; the problem shows as typeset math, not editable. */
  tutorProblem?: TutorProblem;
  /**
   * The folder it is filed in, set by Move (or New in a folder); null: the library's top level.
   * Unset: where it belongs by default, a Shelf board in its book's folder, a free board at the top.
   */
  folderId?: string | null;
  /** When Move last filed it: a move isn't work on the board (updatedAt), but a restore keeps the later filing. */
  filedAt?: number;
  /**
   * A Shelf board holding several marked exercises (Mark → This board), in the order added. Set once a
   * second one joins; the session's problemStatement, problemImage and isSolved are the current one's
   * while open, and isSolved is saved as all of them solved. Unset: the board's one problem is the session's own.
   */
  problems?: BoardProblem[];
  /** Which of `problems` is being worked on (its id). */
  currentProblem?: string;
}

/** One of the exercises on a board that holds several: its mark's id and label, its text and crop, and whether it is solved. */
export interface BoardProblem {
  id: string;
  label: string;
  problemStatement: string;
  problemImage: string | null;
  isSolved?: boolean;
}

/** A folder in the library, inside another (`parentId`) or at the top level (null). */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** What a folder holds, its subfolders included, for its card. */
export interface FolderSummary {
  folders: number;
  books: number;
  problems: number;
  notes: number;
  solved: number;
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

/** What the student asked for when the tutor wrote a board's problem (+ New → Problem from tutor). */
export interface TutorProblem {
  /** A topic from the tutor memory, or one the student typed; '' leaves it to the tutor. */
  topic: string;
  /** The title of a favorite the problem should be like, if one was picked. */
  like?: string;
  /** Anything else the student asked for, in their words. */
  ask?: string;
  /** The tutor's short name for the problem, used as the board's title. */
  title?: string;
  /** Tokens the request for the problem shown took, when the provider reported them. */
  usage?: TokenUsage;
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
  /** The student starred it (see FavoriteProblem). */
  favorite: boolean;
  thumbnail: Blob | null;
  /** Where it was worked on: a free-form board, or an exercise marked on the Shelf. */
  source: 'board' | 'shelf';
  /** Where a Shelf entry opens; free-form boards open in place. */
  href: string | null;
  /** A Shelf entry's PDF and mark (ShelfDocument and ShelfExercise ids); null for free-form boards. */
  bookId: string | null;
  exerciseId: string | null;
  /** Session.folderId as saved (see there for unset). */
  folderId: string | null | undefined;
  /** A board holding several exercises: how many, and how many are solved. Unset: one problem. */
  problems?: { total: number; solved: number };
  /** Something was done on it; false for a Shelf exercise only opened (listed only where its book is). */
  hasWork: boolean;
}

/** History's filter: everything, problems, notes, problems not yet solved, solved problems, or favorites. */
export type HistoryShow = 'all' | 'problems' | 'notes' | 'inProgress' | 'solved' | 'favorites';
/** `book`: a book's boards in the order of their pages (in a folder holding a book). */
export type HistorySort = 'updated' | 'created' | 'title' | 'book';

// === Shelf ===

/** A region of a PDF page, as fractions (0 to 1) of the page's width and height. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a box marked on a Shelf page is: an exercise (a Problem board) or a note page (a Notes board). */
export type ShelfMarkKind = 'exercise' | 'note';

/**
 * An exercise or a note page marked on a Shelf PDF; its board is the session
 * `shelf:<document id>:<exercise id>`.
 */
export interface ShelfExercise {
  id: string;
  /** Unset: an exercise (marks saved before note pages existed). */
  kind?: ShelfMarkKind;
  label: string;
  /** 1-based page number. */
  page: number;
  rect: PageRect;
  createdAt: number;
  /** First page the tutor reads for this exercise, chosen by the student; 0 = none. Unset: worked out from the bookmarks. */
  readFrom?: number;
  /**
   * Added to another mark's board (Mark → This board): that mark's id, so its board is the session
   * `shelf:<document id>:<boardOf>` (which stays even if that mark is removed). Unset: its own board.
   */
  boardOf?: string;
}

/** A PDF on the Shelf, with the exercises and note pages marked on it. */
/** What a Shelf PDF was labelled as by earlier versions (no longer shown: folders organize texts now). */
export type ShelfKind = 'textbook' | 'problem-set' | 'handout';

export interface ShelfDocument {
  id: string;
  title: string;
  file: Blob;
  pageCount: number;
  /** First page, small, for the Shelf grid. */
  cover: Blob | null;
  /** The page the reader was last on (1-based). */
  lastPage: number;
  /** That page's printed number, and the section (bookmark) it is in, for the Shelf card. */
  lastPageLabel?: string;
  lastSection?: string;
  /** Chosen on the card by earlier versions; kept as stored, no longer shown. */
  kind?: ShelfKind;
  exercises: ShelfExercise[];
  /** False when the student turned off trimming the pages' blank margins. Unset: trimmed. */
  trimMargins?: boolean;
  /**
   * The folder it is in: its own folder (`bookFolderId`) when added; null: the library's top level.
   * Unset only on books saved before folders (the database upgrade and restore give them their folder).
   */
  folderId?: string | null;
  /** The folder Mark last filed a board in, where the next one starts. Unset: the book's folder. */
  markFolderId?: string;
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

/** What Settings can ask of Sign in with ChatGPT (POST /api/chatgpt, or the tablet's own client). */
export type ChatGPTAction = 'signIn' | 'cancel' | 'disconnect';

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

/** Page bounds of one crop of the board. */
export interface TutorImageBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A board overview and optional close-ups in reading order; base64 PNGs without the data: prefix. */
export interface TutorBoardImages {
  canvasImage: string;
  canvasDetails?: string[];
}

export interface TutorRequest extends TutorBoardImages {
  problemStatement: string;
  chatHistory: ChatMessage[];
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
  /** On a board holding several exercises: the others' names (the problem above is the one being worked on). */
  otherProblems?: string[];
  /** Write a new problem for the student (MAKE_PROBLEM_PROMPT) instead of tutoring; `avoid` lists problems already offered. */
  makeProblem?: Omit<TutorProblem, 'title' | 'usage'> & { avoid?: string[] };
}

/** One request as the model gets it (planTutorRequest in src/lib/tutorPrompt.ts), for any provider. */
export interface TutorPlan {
  systemPrompt: string;
  /** Shared reference text (book pages or check-in topics), or ''. */
  reference: string;
  /** Fresh learner memory, kept separate from reusable reference material. */
  profile: string;
  history: Pick<ChatMessage, 'role' | 'content'>[];
  /** The current problem and labelled board images, independent of the question and history. */
  board: UserPart[];
  question: string;
  maxTokens: number;
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
  /** Average time from a pen sample to the page handling it, in ms (screen refresh not included); unknown with the BOOX pen SDK. */
  inputDelayMs?: number;
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

/**
 * A problem the student marked as a favorite. Kept in the tutor memory, so it outlives its board and
 * the tutor keeps hearing about it; `id` is the board's session id.
 */
export interface FavoriteProblem {
  id: string;
  /** The board's name when it was starred (or last given a reason). */
  title: string;
  /** A short line on what the problem was: its statement, or where it came from. */
  problem: string;
  /** What made it good, in the student's words; optional. */
  reason: string;
  createdAt: number;
}

/** The tutor's own notes on the student, in its own words: rewritten whole when it learns something worth keeping. */
export interface TutorNotebook {
  text: string;
  updatedAt: number;
  /** The student edited it last. */
  edited?: boolean;
}

/** What the tutor knows about the student: kept on this device, edited by the student, sent with questions. */
export interface LearnerProfile {
  /** In the student's own words: what they study and why, how they like to be helped. */
  aboutMe: string;
  topics: ProfileTopic[];
  /** Problems the student starred, newest first; missing in profiles saved before favorites existed. */
  favorites?: FavoriteProblem[];
  /** The tutor's notebook; unset until it writes one. */
  notebook?: TutorNotebook;
  /** Off: nothing here goes to the tutor. */
  shareWithTutor: boolean;
  updatedAt: number;
}

// === Backup ===

/** A saved session in a backup: the thumbnail Blob as a data URL. */
export type BackupSession = Omit<Session, 'canvasImageBlob'> & { canvasImage: string | null };

/** A Shelf PDF in a backup: the cover as a data URL; the PDF itself is the file `pdfs/<id>.pdf`. */
export type BackupShelfDocument = Omit<ShelfDocument, 'file' | 'cover'> & { cover: string | null };

/** One board in a version 2 backup: its file beside backup.json (`boards/<id>.json`, a `BackupSession`). */
export interface BackupBoardEntry {
  id: string;
  file: string;
}

/**
 * `backup.json`: everything the app keeps, apart from the Shelf's PDF files and (from version 2)
 * the boards, which are files of their own so a folder backup rewrites only the boards that changed.
 */
export interface BackupManifest {
  app: 'math-tutor';
  version: 1 | 2;
  createdAt: number;
  /** Version 1: every board, inline. */
  sessions?: BackupSession[];
  /** Version 2: every board, as a file. */
  boards?: BackupBoardEntry[];
  shelf: BackupShelfDocument[];
  /** Tutor memory; missing in backups made before it existed. */
  profile?: LearnerProfile;
  /** Ink on Shelf pages; missing in backups made before it existed. */
  ink?: PageInk[];
  /** The library's folders; missing in backups made before them. */
  folders?: Folder[];
}

/** What a restore did: records added or updated, and those left alone because this device's copy is as new. */
export interface RestoreResult {
  restoredSessions: number;
  restoredShelf: number;
  restoredFolders: number;
  /** The tutor memory was newer in the backup and replaced this device's. */
  restoredProfile: boolean;
  /** Pages of Shelf ink added or updated. */
  restoredInk: number;
  skipped: number;
  /** Shelf PDFs listed in the backup whose file wasn't with it (and isn't on this device). */
  missingPdfs: string[];
  /** Boards listed in the backup whose file wasn't with it (only backup.json was picked, say). */
  missingBoards: number;
}

/** Automatic backup to a folder, as the Backup settings and the top bar show it. */
export interface BackupStatus {
  /** False where the browser can't write to a folder (e.g. Firefox); downloads still work. */
  folderSupported: boolean;
  /** The Android app: the folder is picked through Android (BackupFolderPlugin), not the browser. */
  androidFolder: boolean;
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

/** A file the Android app writes a piece at a time (SaveFilePlugin, BackupFolderPlugin): data is base64. */
export interface ChunkWriterPlugin {
  write(options: { id: string; data: string }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  /** Closes and deletes the file. */
  abort(options: { id: string }): Promise<void>;
}

/** The Android app's native Save dialog (android/…/SaveFilePlugin.java): no id when it was cancelled. */
export interface SaveFilePlugin extends ChunkWriterPlugin {
  open(options: { name: string; mimeType: string }): Promise<{ id?: string }>;
}

/** Where in a backup folder (android/…/BackupFolderPlugin.java): the picked tree and the folders inside it. */
export interface BackupFolderPlace { tree: string; path: string[] }

/** The Android app's backup folder, picked with Android's folder picker and kept across starts. */
export interface BackupFolderPlugin extends ChunkWriterPlugin {
  /** No tree when the picker was cancelled; keep: false reads it this once (a restore). */
  pick(options?: { keep?: boolean }): Promise<{ tree?: string; name?: string }>;
  check(options: { tree: string }): Promise<{ granted: boolean }>;
  release(options: { tree: string }): Promise<void>;
  list(options: BackupFolderPlace & { create?: boolean }): Promise<{ entries: { name: string; directory: boolean; size: number }[] }>;
  openWrite(options: BackupFolderPlace & { name: string }): Promise<{ id: string }>;
  read(options: BackupFolderPlace & { name: string; offset: number; length: number }): Promise<{ data: string }>;
  remove(options: BackupFolderPlace & { name: string }): Promise<void>;
}

/** A folder the backup writes into: a browser's folder handle, or a folder picked in the Android app. */
export interface BackupDirectory {
  readonly name: string;
  /** The folder of that name inside this one, made when missing. */
  directory(name: string): Promise<BackupDirectory>;
  names(): Promise<string[]>;
  /** A file's size; null when it isn't there. */
  size(name: string): Promise<number | null>;
  write(name: string, contents: Blob): Promise<void>;
  /** Deletes a file or a folder with what is in it. */
  remove(name: string): Promise<void>;
}

/**
 * The Android app's API keys (android/…/DeviceKeysPlugin.java): kept in the app's private storage,
 * encrypted with a key in the Android Keystore, and left out of Android's backups.
 */
export interface DeviceKeysPlugin {
  /** An API key, or 'chatgpt': the Sign in with ChatGPT connection (src/lib/chatgptDevice.ts). */
  get(options: { name: DeviceKeyName | 'chatgpt' }): Promise<{ value?: string }>;
  set(options: { name: DeviceKeyName | 'chatgpt'; value: string }): Promise<void>;
  remove(options: { name: DeviceKeyName | 'chatgpt' }): Promise<void>;
}

/** A box in CSS px relative to the app's WebView (the page's viewport). */
export interface BooxPenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One sample of a BOOX pen stroke: CSS px in the viewport, pressure 0–1, ms since the stroke began. */
export interface BooxPenPoint {
  x: number;
  y: number;
  pressure: number;
  ms: number;
}

/**
 * Onyx's pen SDK on BOOX tablets (android/…/BooxPenPlugin.java): inside `region` the e-ink
 * controller draws the stylus itself, and each finished stroke arrives as a `stroke` event
 * (`erase` for the pen's eraser end) with points flattened as [x, y, pressure, ms, …].
 * Everything but status() is refused on other devices.
 */
export interface BooxPenPlugin {
  status(): Promise<{ onyx: boolean; active: boolean; fast?: boolean }>;
  /** Fast screen updates for editing tools or finger gestures; leaving does not force a repaint. */
  interaction(options: { active: boolean }): Promise<{ active: boolean }>;
  /** `color` is the preview's ink as #rrggbb (black when left out); `marker` draws it with a flat marker tip (a highlighter). */
  start(options: { region: BooxPenBox; exclude?: BooxPenBox[]; width: number; color?: string; marker?: boolean }): Promise<void>;
  /** Update the preview width in CSS pixels (and its color and tip) without restarting pen input. */
  setWidth(options: { width: number; color?: string; marker?: boolean }): Promise<void>;
  setRegion(options: { region: BooxPenBox; exclude?: BooxPenBox[] }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Lets the screen show the page's own drawing again (raw drawing holds it back). */
  refresh(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'stroke' | 'erase', listener: (data: { points: number[] }) => void): Promise<{ remove: () => Promise<void> }>;
}

/** The Android app's side of Sign in with ChatGPT (android/…/ChatGPTSignInPlugin.java). */
export interface ChatGPTSignInPlugin {
  /** Listens on 127.0.0.1:port for the callback carrying `state`. */
  listen(options: { port: number; state: string }): Promise<{ redirectUri: string }>;
  /** The matching callback's query string; rejects when the listener closes first. */
  waitForCallback(): Promise<{ query: string }>;
  close(): Promise<void>;
  openBrowser(options: { url: string }): Promise<void>;
}

/**
 * Installs a newer build of the Android app (android/…/AppUpdatePlugin.java): downloads the APK and
 * opens Android's installer. `permission: false`: Android's "install unknown apps" setting was opened instead.
 */
export interface AppUpdatePlugin {
  install(options: { url: string }): Promise<{ permission: boolean }>;
}
