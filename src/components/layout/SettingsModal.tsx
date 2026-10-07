'use client';

import { useState } from 'react';
import type { ModelConfig, Provider } from '@/types';
import { getModelConfig, saveModelConfig } from '@/lib/modelConfig';
import { useChatGPTConnection } from '@/hooks/useChatGPTConnection';
import { CHATGPT_DEFAULT_MODEL_PATTERN, CHATGPT_USAGE_URL } from '@/lib/constants';

const PRESETS: { label: string; provider: Provider; model: string; baseUrl: string }[] = [
  { label: 'Anthropic (Claude)', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', baseUrl: '' },
  { label: 'ChatGPT plan (Sign in with ChatGPT)', provider: 'chatgpt', model: '', baseUrl: '' },
  { label: 'Google Gemini', provider: 'openai-compatible', model: 'gemini-3-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
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

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;
  return <SettingsForm onClose={onClose} />;
}

function SettingsForm({ onClose }: Pick<Props, 'onClose'>) {
  const [config, setConfig] = useState<ModelConfig>(getModelConfig);
  const [presetIdx, setPresetIdx] = useState(() => findPresetIndex(getModelConfig()));
  const isChatGPT = PRESETS[presetIdx]?.provider === 'chatgpt';
  const chatgpt = useChatGPTConnection(isChatGPT);
  const chatgptModels = chatgpt.status.models;
  // Default to the lightest model the plan offers; hints don't need a frontier model.
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

  const handleSave = () => {
    saveModelConfig(isChatGPT ? { ...config, model: chatgptModel } : config);
    onClose();
  };

  const isOpenAICompatible = PRESETS[presetIdx]?.provider === 'openai-compatible';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Model Settings</h2>

        {/* Provider preset */}
        <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
        <select
          value={presetIdx}
          onChange={(e) => handlePresetChange(Number(e.target.value))}
          className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">
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
            className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </>
        )}

        <p className="text-xs text-gray-500 mb-4">
          {config.provider === 'anthropic'
            ? 'API key read from .env.local (ANTHROPIC_API_KEY)'
            : config.provider === 'chatgpt'
              ? 'No API key needed. Requests count against your ChatGPT plan limits.'
              : 'API key read from .env.local (OPENAI_API_KEY). Ollama does not need one.'}
        </p>

        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
