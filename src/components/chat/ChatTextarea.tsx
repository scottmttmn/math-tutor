'use client';

import { useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

/** Tallest the box grows before it scrolls, in pixels (about six lines of text-sm). */
const MAX_HEIGHT = 128;

type ChatTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'rows'> & { value: string };

/**
 * The chat message box: wraps and grows with the message up to MAX_HEIGHT, then scrolls.
 * Enter sends (submits the enclosing form); Shift+Enter adds a new line.
 */
export default function ChatTextarea({ value, className = '', onKeyDown, ...props }: ChatTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT)}px`;
    box.style.overflowY = box.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

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
