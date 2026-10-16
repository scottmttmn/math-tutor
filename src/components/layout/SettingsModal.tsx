'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModelConfig, Provider } from '@/types';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_GEMINI_MODEL, GEMINI_BASE_URL, getModelConfig, isGeminiEndpoint, saveModelConfig } from '@/lib/modelConfig';
import { useChatGPTConnection } from '@/hooks/useChatGPTConnection';
import { CHATGPT_DEFAULT_MODEL_PATTERN, CHATGPT_USAGE_URL } from '@/lib/constants';
import { TUTOR_DIRECT } from '@/lib/tutorRequest';
import { DEVICE_KEY_LABELS, deviceKeyName } from '@/lib/deviceKeys';
import { useDeviceKey } from '@/hooks/useDeviceKey';
import BackupSettings from './BackupSettings';

const PRESETS: { label: string; provider: Provider; model: string; baseUrl: string }[] = [
  { label: 'Anthropic (Claude)', provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, baseUrl: '' },
  { label: 'ChatGPT plan (Sign in with ChatGPT)', provider: 'chatgpt', model: '', baseUrl: '' },
  { label: 'Google Gemini', provider: 'openai-compatible', model: DEFAULT_GEMINI_MODEL, baseUrl: GEMINI_BASE_URL },
  { label: 'OpenAI', provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  { label: 'Groq', provider: 'openai-compatible', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama', provider: 'openai-compatible', model: 'llama3.2-vision', baseUrl: process.env.NEXT_PUBLIC_OLLAMA_BASE_URL ?? 'http://localhost:11434/v1' },
  { label: 'Custom', provider: 'openai-compatible', model: '', baseUrl: '' },
];
function findPresetIndex(config: ModelConfig): number {
  const idx = PRESETS.findIndex(
    (p) => p.provider === config.provider && p.baseUrl === config.baseUrl && p.label !== 'Custom',
  );
  return idx >= 0 ? idx : PRESETS.length - 1; // fall back to Custom
}

export type SettingsTab = 'tutor' | 'backup';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The tab shown first; the tutor's model unless given. */
  tab?: SettingsTab;
  /** Saves the board open on this page before a backup or restore. */
  saveOpenBoard?: () => Promise<unknown>;
  /** A restore's result, shown on the Backup tab after the page reloaded. */
  restoredMessage?: string;
}

const TABS: { tab: SettingsTab; label: string }[] = [{ tab: 'tutor', label: 'Tutor' }, { tab: 'backup', label: 'Backup' }];

export default function SettingsModal({ isOpen, tab = 'tutor', ...rest }: Props) {
  if (!isOpen) return null;
  return <SettingsDialog {...rest} initialTab={tab} />;
}

function SettingsDialog({ onClose, initialTab, saveOpenBoard, restoredMessage }: Omit<Props, 'isOpen' | 'tab'> & { initialTab: SettingsTab }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div role="dialog" aria-label="Settings" className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div role="tablist" className="flex gap-1 mb-4 border-b border-gray-200">
          {TABS.map((item) => (
            <button
              key={item.tab}
              role="tab"
              aria-selected={tab === item.tab}
              onClick={() => setTab(item.tab)}
              className={`min-h-11 px-3 -mb-px text-sm border-b-2 ${tab === item.tab ? 'font-semibold text-gray-900 border-gray-900' : 'text-gray-600 border-transparent hover:text-gray-900'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'tutor' ? <SettingsForm onClose={onClose} saveOpenBoard={saveOpenBoard} /> : <BackupSettings onClose={onClose} saveOpenBoard={saveOpenBoard} restoredMessage={restoredMessage} />}
      </div>
    </div>
  );
}

function SettingsForm({ onClose, saveOpenBoard }: { onClose: () => void; saveOpenBoard?: () => Promise<unknown> }) {
  const router = useRouter();
  const [config, setConfig] = useState<ModelConfig>(getModelConfig);
  const [presetIdx, setPresetIdx] = useState(() => findPresetIndex(getModelConfig()));
  const isChatGPT = PRESETS[presetIdx]?.provider === 'chatgpt';
  const keyName = TUTOR_DIRECT ? deviceKeyName(config) : null;
  const deviceKey = useDeviceKey(keyName);
  const [keyDraft, setKeyDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const chatgpt = useChatGPTConnection(isChatGPT);
  const chatgptModels = chatgpt.status.models;
  // A saved plan model stays; otherwise use the default (see CHATGPT_DEFAULT_MODEL_PATTERN).
  const chatgptModel = chatgptModels?.some((m) => m.slug === config.model)
    ? config.model
    : (chatgptModels?.find((m) => CHATGPT_DEFAULT_MODEL_PATTERN.test(`${m.slug} ${m.displayName}`)) ?? chatgptModels?.[0])?.slug
      ?? config.model;

  const handlePresetChange = (idx: number) => {
    setPresetIdx(idx);
    const preset = PRESETS[idx];
    setConfig({
      provider: preset.provider,
      model: preset.model || config.model,
      baseUrl: preset.baseUrl,
    });
  };

  const handleSave = async () => {
    if (keyName && keyDraft.trim()) {
      try {
        await deviceKey.save(keyDraft.trim());
      } catch {
        setSaveError('Could not save the key on this tablet.');
        return;
      }
    }
    saveModelConfig(isChatGPT ? { ...config, model: chatgptModel } : config);
    onClose();
  };

  const isOpenAICompatible = PRESETS[presetIdx]?.provider === 'openai-compatible';

  return (
    <>
      <button
        onClick={() => {
          // Leave even if the save fails: the board's recovery copy keeps the work.
          void (saveOpenBoard?.() ?? Promise.resolve()).catch(() => undefined).then(() => { onClose(); router.push('/memory'); });
        }}
        className="w-full mb-4 min-h-11 px-3 py-2 text-left text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        <span className="block font-medium text-gray-900">Tutor memory →</span>
        <span className="block text-gray-600">What you&apos;ve told the tutor about yourself and what you know.</span>
      </button>

      {/* Provider preset */}
      <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
      <select
        value={presetIdx}
        onChange={(e) => handlePresetChange(Number(e.target.value))}
        className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        {PRESETS.map((p, i) => (
          <option key={p.label} value={i}>{p.label}</option>
        ))}
      </select>

      {/* ChatGPT plan connection */}
      {isChatGPT && (
        <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50 text-sm">
          {chatgpt.isLoading ? (
            <p className="text-gray-500">Checking your ChatGPT connection...</p>
          ) : chatgpt.status.status === 'connecting' ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-gray-600">Finish signing in in the browser tab that opened.</p>
              <button
                onClick={chatgpt.cancelSignIn}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-white"
              >
                Cancel
              </button>
            </div>
          ) : chatgpt.status.status === 'connected' ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-gray-700">
                Signed in{chatgpt.status.email ? ` as ${chatgpt.status.email}` : ''}.
                {!chatgpt.status.sharing && ' Plan usage is not enabled for this app yet.'}
                {chatgpt.status.sharing && (
                  <>
                    {' '}
                    <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="text-gray-900 underline">
                      Manage usage
                    </a>
                  </>
                )}
              </p>
              <button
                onClick={chatgpt.status.sharing ? chatgpt.disconnect : chatgpt.signIn}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-white shrink-0"
              >
                {chatgpt.status.sharing ? 'Sign out' : 'Enable'}
              </button>
            </div>
          ) : (
            <button
              onClick={chatgpt.signIn}
              className="w-full px-4 py-2 text-sm text-white bg-black rounded-lg hover:bg-gray-800"
            >
              Sign in with ChatGPT
            </button>
          )}
          {chatgpt.status.error && (
            <p className="mt-2 text-xs text-red-600">{chatgpt.status.error}</p>
          )}
        </div>
      )}

      {/* Model */}
      <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
      {isChatGPT && chatgptModels?.length ? (
        <select
          value={chatgptModel}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          {chatgptModels.map((m) => (
            <option key={m.slug} value={m.slug}>{m.displayName}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="Model name"
          className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      )}

      {/* Base URL (all non-Anthropic providers) */}
      {isOpenAICompatible && (
        <>
          <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="http://192.168.x.x:11434/v1"
            className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </>
      )}

      {keyName ? (
        <div className="mb-4">
          <label htmlFor="device-api-key" className="block text-sm font-medium text-gray-700 mb-1">{DEVICE_KEY_LABELS[keyName]}</label>
          <input
            id="device-api-key"
            type="password"
            autoComplete="off"
            value={keyDraft}
            onChange={(e) => { setKeyDraft(e.target.value); setSaveError(null); }}
            placeholder={deviceKey.saved ? 'Saved. Paste a new key to replace it' : 'Paste your key'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <div className="flex items-start justify-between gap-2 mt-1">
            <p className="text-xs text-gray-500">
              Kept on this tablet, encrypted, and never in backups.{keyName === 'openai' ? ' Ollama needs none.' : ''}
            </p>
            {deviceKey.saved && (
              <button onClick={() => void deviceKey.remove()} className="min-h-11 px-2 text-xs text-gray-700 underline shrink-0">
                Remove key
              </button>
            )}
          </div>
          {(saveError || deviceKey.error) && <p className="mt-1 text-xs text-red-600">{saveError || deviceKey.error}</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-4">
          {config.provider === 'anthropic'
            ? 'API key read from .env.local (ANTHROPIC_API_KEY)'
            : config.provider === 'chatgpt'
              ? 'No API key needed. Requests count against your ChatGPT plan limits.'
              : isGeminiEndpoint(config.baseUrl)
                ? 'Gemini API key read from .env.local (GEMINI_API_KEY or GOOGLE_API_KEY)'
                : 'API key read from .env.local (OPENAI_API_KEY). Ollama does not need one.'}
        </p>
      )}
      {config.provider !== 'chatgpt' && isGeminiEndpoint(config.baseUrl) && <p className="text-xs text-gray-500 mb-4">
        Flash models automatically fall back through older Flash models, then Flash-Lite, when a quota is exhausted. Replies identify any fallback used.
      </p>}

      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700"
        >
          Save
        </button>
      </div>
    </>
  );
}
