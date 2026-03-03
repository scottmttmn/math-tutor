'use client';

import { useState, useEffect } from 'react';
import type { ModelConfig, Provider } from '@/types';
import { getModelConfig, saveModelConfig } from '@/lib/modelConfig';

const PRESETS: { label: string; provider: Provider; model: string; baseUrl: string }[] = [
  { label: 'Anthropic (Claude)', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', baseUrl: '' },
  { label: 'Google Gemini', provider: 'openai-compatible', model: 'gemini-2.0-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { label: 'OpenAI', provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  { label: 'Groq', provider: 'openai-compatible', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama (local)', provider: 'openai-compatible', model: 'llama3.2-vision', baseUrl: 'http://localhost:11434/v1' },
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
  const [config, setConfig] = useState<ModelConfig>(getModelConfig);
  const [presetIdx, setPresetIdx] = useState(() => findPresetIndex(getModelConfig()));

  useEffect(() => {
    if (isOpen) {
      const cfg = getModelConfig();
      setConfig(cfg);
      setPresetIdx(findPresetIndex(cfg));
    }
  }, [isOpen]);

  if (!isOpen) return null;

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
    saveModelConfig(config);
    onClose();
  };

  const isCustom = presetIdx === PRESETS.length - 1;

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

        {/* Model */}
        <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="Model name"
          className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Base URL (only for Custom) */}
        {isCustom && (
          <>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </>
        )}

        <p className="text-xs text-gray-500 mb-4">
          API keys are read from .env.local ({config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'})
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
