'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { DefaultColorStyle, DefaultSizeStyle, DefaultStylePanel, getColorValue, useEditor, useRelevantStyles, useValue, type TLEventInfo } from 'tldraw';

const OPEN_KEY = 'math-tutor:stylePanelOpen';

/** A small header around tldraw's own style controls, including styles of selected shapes. */
export default function PenStylePanel() {
  const editor = useEditor();
  const styles = useRelevantStyles();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pen = useValue('pen chip styles', () => {
    const color = styles?.get(DefaultColorStyle);
    const size = styles?.get(DefaultSizeStyle);
    const colorValue = color?.type === 'shared' ? color.value : editor.getStyleForNextShape(DefaultColorStyle);
    return {
      color: color?.type === 'mixed' ? 'mixed colors' : colorValue.replaceAll('-', ' '),
      size: size?.type === 'mixed' ? 'Mixed' : (size?.value ?? editor.getStyleForNextShape(DefaultSizeStyle)).toUpperCase(),
      ink: getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], colorValue, 'solid'),
      mixed: color?.type === 'mixed',
    };
  }, [editor, styles]);

  useEffect(() => {
    // Read after mounting, so the server and initial browser render both start collapsed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setOpen(localStorage.getItem(OPEN_KEY) === 'true'); } catch { /* storage blocked */ }
  }, []);

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, String(next)); } catch { /* still works without storage */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const doc = editor.getContainer().ownerDocument;
    const onEvent = (event: TLEventInfo) => {
      // UI events do not reach the editor; picking several styles leaves the panel open.
      if (event.name === 'pointer_down' && editor.isIn('draw.drawing')) changeOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Esc closes this panel first, keeping a selected shape selected for further restyling.
      event.preventDefault();
      event.stopPropagation();
      changeOpen(false);
      // Return focus before unmounting a focused picker.
      if (doc.getElementById(panelId)?.contains(doc.activeElement)) editor.getContainer().focus();
    };
    editor.on('event', onEvent);
    doc.addEventListener('keydown', onKey, true);
    return () => {
      editor.off('event', onEvent);
      doc.removeEventListener('keydown', onKey, true);
    };
  }, [editor, open, changeOpen, panelId]);

  const label = `Pen: ${pen.color}, ${pen.size}`;
  return (
    <div className="m-2 flex max-h-full min-h-0 flex-col items-end gap-1 pointer-events-auto">
      <button type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => changeOpen(!open)}
        className={`flex shrink-0 items-center justify-center gap-2 min-h-11 px-3 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 ${open ? 'w-[148px]' : ''}`}>
        <span aria-hidden="true" className={`h-3 w-3 rounded-full border border-gray-400 ${pen.mixed ? 'bg-gray-200' : ''}`} style={pen.mixed ? undefined : { backgroundColor: pen.ink }} />
        <span aria-hidden="true">{pen.size}</span>
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Pen styles" className="min-h-0 overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-sm">
          {/* Keep the native palette for now; trim colors/opacity only after the BOOX pen test. */}
          <DefaultStylePanel isMobile styles={styles} />
        </div>
      )}
    </div>
  );
}
