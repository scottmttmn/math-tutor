'use client';

interface Props {
  onNew: () => void;
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

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10a2 2 0 0 1-2 2H5l-3 3V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7z" />
    </svg>
  );
}
