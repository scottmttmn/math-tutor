'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  checked?: boolean;
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  separatorBefore?: boolean;
  content?: ReactNode;
  className?: string;
}

interface Props {
  label: string;
  items: MoreMenuItem[];
  disabled?: boolean;
  /** What the button shows instead of "⋯" (then `label` is only its accessible name if it differs). */
  button?: ReactNode;
  /** Opens upward, for a menu at the foot of the screen. */
  above?: boolean;
  /** Replaces the button's own look (for a menu that is a screen's main action, such as Ask tutor). */
  buttonClassName?: string;
  title?: string;
  align?: 'left' | 'right';
  menuClassName?: string;
}

/** A "⋯" button holding a card's or board's less common actions, such as Rename and Delete. */
export default function MoreMenu({ label, items, disabled = false, button, above = false, buttonClassName, title, align = 'right', menuClassName }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuShift, setMenuShift] = useState(0);

  // A wrapped toolbar can put its trigger near either edge of the screen.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const bounds = menu.current?.getBoundingClientRect();
      if (!bounds) return;
      const left = bounds.left - menuShift;
      const shift = Math.max(8 - left, 0) - Math.max(left + bounds.width - (window.innerWidth - 8), 0);
      if (Math.abs(shift - menuShift) > 0.5) setMenuShift(shift);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, menuShift, align, above]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        className={buttonClassName ?? `flex items-center justify-center min-h-11 min-w-11 ${button ? 'gap-1.5 px-3 text-sm text-gray-800' : 'text-lg leading-none text-gray-700'} border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50`}
      >
        {button ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label}
          style={{ '--menu-shift': `${menuShift}px` } as CSSProperties}
          onKeyDown={(event) => {
            if (event.key === 'Tab') { setOpen(false); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
            buttons[index]?.focus();
          }}
          className={`absolute translate-x-[var(--menu-shift)] max-w-[calc(100vw-1rem)] ${align === 'left' ? 'left-0' : 'right-0'} ${above ? 'bottom-full mb-1' : 'top-full mt-1'} ${menuClassName ?? 'w-52 py-1'} bg-white border border-gray-300 rounded-lg shadow-lg z-50`}>
          {items.map((item) => (
            <Fragment key={item.label}>
            {item.separatorBefore && <div role="separator" className="my-1 border-t border-gray-200" />}
            <button
              role={item.role ?? 'menuitem'}
              aria-label={item.label}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect(); }}
              className={item.className ?? 'w-full min-h-11 px-3 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50'}
            >
              {item.content ?? <>{item.checked !== undefined && <span aria-hidden="true" className="inline-block w-5">{item.checked ? '✓' : ''}</span>}{item.label}</>}
            </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
