import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CrashLogPlugin, ErrorLogEntry } from '@/types';
import { getSetting, setSetting } from '@/lib/db';
import { APP_BUILD } from '@/lib/constants';

// What went wrong on this device, kept so it can be read or sent later (Settings → Errors): the
// page's uncaught errors and rejections, and in the Android app what CrashLogPlugin recorded
// natively (crashes, the page's process dying, the app closed for memory or not responding).
// It lives in the IndexedDB settings store, not in backups.

const CrashLog = registerPlugin<CrashLogPlugin>('CrashLog');

export const ERROR_LOG_KEY = 'errorLog';
/** The newest entries kept. */
export const MAX_ERRORS = 100;
/** The same error again within this long is not added again (a loop would fill the log). */
export const REPEAT_MS = 5000;
const MAX_DETAIL = 16 * 1024;

/** Messages browsers raise that are harmless. */
const IGNORED = [/^ResizeObserver loop/];

/** The log with an entry added: newest last, at most MAX_ERRORS, a quick repeat left out. */
export function withEntry(log: ErrorLogEntry[], entry: ErrorLogEntry): ErrorLogEntry[] {
  if (IGNORED.some((pattern) => pattern.test(entry.message))) return log;
  const repeat = log.findLast((old) => old.kind === entry.kind && old.message === entry.message);
  if (repeat && Math.abs(entry.at - repeat.at) < REPEAT_MS) return log;
  const next = [...log, entry].sort((a, b) => a.at - b.at);
  return next.slice(Math.max(0, next.length - MAX_ERRORS));
}

/** The native log's JSON lines as entries; a line that doesn't parse is skipped. */
export function parseNativeLog(lines: string): ErrorLogEntry[] {
  const entries: ErrorLogEntry[] = [];
  for (const line of lines.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<ErrorLogEntry>;
      if (typeof value.at !== 'number' || typeof value.kind !== 'string' || typeof value.message !== 'string') continue;
      entries.push({
        at: value.at,
        kind: value.kind as ErrorLogEntry['kind'],
        message: value.message,
        ...(typeof value.detail === 'string' && { detail: value.detail }),
        ...(typeof value.build === 'string' && { build: value.build }),
      });
    } catch {
      // A line cut off by the crash it was describing.
    }
  }
  return entries;
}

// Writes one at a time, so two errors at once don't drop each other.
let writing: Promise<unknown> = Promise.resolve();

function update(change: (log: ErrorLogEntry[]) => ErrorLogEntry[]) {
  const next = writing.then(async () => {
    const log = (await getSetting<ErrorLogEntry[]>(ERROR_LOG_KEY)) ?? [];
    const changed = change(log);
    if (changed !== log) await setSetting(ERROR_LOG_KEY, changed);
  });
  writing = next.catch(() => undefined);
  return next;
}

export async function listErrors(): Promise<ErrorLogEntry[]> {
  await writing;
  return (await getSetting<ErrorLogEntry[]>(ERROR_LOG_KEY)) ?? [];
}

export const clearErrors = () => update((log) => (log.length ? [] : log));

/** Adds an entry, never throwing (the log must not cause errors of its own). */
export function recordError(entry: Omit<ErrorLogEntry, 'at'> & { at?: number }) {
  const full: ErrorLogEntry = {
    ...entry,
    at: entry.at ?? Date.now(),
    ...(entry.detail && { detail: entry.detail.slice(0, MAX_DETAIL) }),
    ...(!entry.build && APP_BUILD && { build: APP_BUILD }),
  };
  return update((log) => withEntry(log, full)).catch(() => undefined);
}

function describe(reason: unknown): { message: string; detail?: string } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, detail: reason.stack };
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { message: String(reason) };
  }
}

const here = () => location.pathname + location.search;

let installed = false;

/** Starts recording the page's uncaught errors, and takes in what the Android app recorded natively. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    const { message, detail } = event.error !== undefined && event.error !== null ? describe(event.error) : { message: event.message, detail: undefined };
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '';
    recordError({ kind: 'error', message: message || 'Unknown error', detail: detail ?? (where || undefined), page: here() });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const { message, detail } = describe(event.reason);
    recordError({ kind: 'promise', message: message || 'Unknown rejection', detail, page: here() });
  });
  void takeNativeLog();
}

async function takeNativeLog() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('CrashLog')) return;
  try {
    const { lines } = await CrashLog.take();
    const entries = parseNativeLog(lines);
    if (entries.length) await update((log) => entries.reduce(withEntry, log));
  } catch {
    // Nothing to add.
  }
}

export const ERROR_KIND_LABELS: Record<string, string> = {
  error: 'Page error',
  promise: 'Page error',
  crash: 'App crashed',
  'native-crash': 'App crashed',
  'not-responding': 'Not responding',
  'page-process': 'Page stopped',
  exit: 'App closed',
};

/** The log as plain text, to copy or save and send. */
export function errorLogText(entries: ErrorLogEntry[], device: { build: string; userAgent: string; now: number }) {
  const lines = [
    'Math Tutor error log',
    `Saved: ${new Date(device.now).toISOString()}`,
    `Build: ${device.build || 'local'}`,
    `Device: ${device.userAgent}`,
    `Entries: ${entries.length}`,
  ];
  for (const entry of [...entries].reverse()) {
    lines.push('', `[${new Date(entry.at).toISOString()}] ${ERROR_KIND_LABELS[entry.kind] ?? entry.kind} (${entry.kind}): ${entry.message}`);
    if (entry.build) lines.push(`Build: ${entry.build}`);
    if (entry.page) lines.push(`Page: ${entry.page}`);
    if (entry.detail) lines.push(entry.detail);
  }
  return lines.join('\n') + '\n';
}
