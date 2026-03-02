'use client';

import { useEffect, useState } from 'react';
import { listSessions, deleteSession as dbDeleteSession } from '@/lib/db';
import type { SessionMetadata } from '@/types';
import SessionCard from './SessionCard';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (id: string) => void;
}

export default function SessionList({ isOpen, onClose, onLoad }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);

  useEffect(() => {
    if (isOpen) {
      listSessions().then((all) => {
        setSessions(
          all.map((s) => ({
            id: s.id,
            title: s.title,
            problemStatement: s.problemStatement,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: s.chatHistory.length,
          }))
        );
      });
    }
  }, [isOpen]);

  const handleDelete = async (id: string) => {
    await dbDeleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">Saved Sessions</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No saved sessions yet.
            </p>
          ) : (
            sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onLoad={(id) => { onLoad(id); onClose(); }}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
