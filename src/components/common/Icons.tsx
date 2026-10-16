import type { ReactNode } from 'react';
import type { SessionType } from '@/types';

// Line icons drawn in the current text color, so they read the same on an e-ink screen.
function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

export function ProblemIcon() {
  return <Icon><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M5 8.5l2 2 4-4.5" /></Icon>;
}

export function NotesIcon({ size }: { size?: number } = {}) {
  return <Icon size={size}><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5h6M5 8h6M5 11h4" /></Icon>;
}

/** Anything on the Shelf: a PDF. */
export function ShelfIcon() {
  return <Icon><path d="M3.5 1.5h6l3 3v10h-9z" /><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" /></Icon>;
}

/** The tutor's mark; only the tutor uses it, always in the tutor color. */
export function TutorIcon() {
  return <Icon><path d="M14 10a2 2 0 0 1-2 2H6l-3.5 2.5V4a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2z" /></Icon>;
}

export function HomeIcon() {
  return <Icon><path d="M2 7.5L8 2.5l6 5M3.5 6.5v7h9v-7" /></Icon>;
}

export function GearIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </Icon>
  );
}

export function FullScreenIcon() {
  return <Icon><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Icon>;
}

export function KindIcon({ type }: { type: SessionType }) {
  return type === 'note' ? <NotesIcon /> : <ProblemIcon />;
}

/** Solved: a filled ink check, the same everywhere (no green). */
export function SolvedCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.3l2.3 2.2 4.7-5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Not yet solved: the same check, as an outline. */
export function UnsolvedCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="7" />
      <path d="M4.5 8.3l2.3 2.2 4.7-5" />
    </svg>
  );
}
