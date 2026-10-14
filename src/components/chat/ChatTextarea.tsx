'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

/** Tallest the box grows before it scrolls, in pixels (about six lines of text-sm). */
const MAX_HEIGHT = 128;

function fitHeight(box: HTMLTextAreaElement) {
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT)}px`;
  box.style.overflowY = box.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
}

type ChatTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'rows'> & { value: string };

/**
 * The chat message box: wraps and grows with the message up to MAX_HEIGHT, then scrolls.
 * Enter sends (submits the enclosing form); Shift+Enter adds a new line.
 */
export default function ChatTextarea({ value, className = '', onKeyDown, ...props }: ChatTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current);
  }, [value]);

  // A width change (rotating a tablet, resizing the window) rewraps the text, so measure again.
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      fitHeight(box);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onKeyDown={handleKeyDown}
      className={`resize-none leading-5 ${className}`}
      {...props}
    />
  );
}
