'use client';

interface Props {
  onNew: () => void;
  onSave: () => void;
  onOpenSessions: () => void;
}

export default function TopBar({ onNew, onSave, onOpenSessions }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-bold text-gray-800">Math Tutor</h1>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onNew}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          New
        </button>
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
