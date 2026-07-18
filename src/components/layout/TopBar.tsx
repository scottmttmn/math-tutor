'use client';

import { useState, useRef, useEffect } from 'react';
import type { SessionType } from '@/types';

interface Props {
  onNew: (type: SessionType) => void;
  onSave: () => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  modelLabel: string;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export default function TopBar({
  onNew,
  onSave,
  onOpenSessions,
  onOpenSettings,
  modelLabel,
  chatOpen,
  onToggleChat,
}: Props) {
  const [newDropdownOpen, setNewDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setNewDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNew = (type: SessionType) => {
    onNew(type);
    setNewDropdownOpen(false);
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-bold text-gray-800">Math Tutor</h1>
        <span className="text-xs text-gray-400 hidden sm:inline">{modelLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        {/* Chat panel toggle */}
        <button
          onClick={onToggleChat}
          title={chatOpen ? 'Hide chat' : 'Show chat'}
          className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            chatOpen
              ? 'bg-blue-50 text-blue-600 border border-blue-200'
              : 'text-gray-600 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          <ChatIcon />
          Chat
        </button>

        <div className="w-px h-4 bg-gray-200" />

        <button
          onClick={onOpenSettings}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          title="Model settings"
        >
          Settings
        </button>

        {/* New — dropdown for Problem vs Notes */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setNewDropdownOpen((o) => !o)}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"
          >
            New
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
          {newDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={() => handleNew('problem')}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <span>📐</span> New Problem
              </button>
              <button
                onClick={() => handleNew('note')}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <span>📝</span> New Notes
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onSave}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Save
        </button>
        <button
          onClick={onOpenSessions}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Load
        </button>
      </div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10a2 2 0 0 1-2 2H5l-3 3V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7z" />
    </svg>
  );
}
