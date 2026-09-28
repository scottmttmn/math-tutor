import type { ModelConfig } from '@/types';

const STORAGE_KEY = 'mathTutor_modelConfig';

const DEFAULT_CONFIG: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  baseUrl: '',
};

export function getModelConfig(): ModelConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveModelConfig(config: ModelConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event('mathTutor:modelConfigChanged'));
}

export function subscribeModelConfig(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('mathTutor:modelConfigChanged', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('mathTutor:modelConfigChanged', onChange);
  };
}

export const getModelLabel = () => getModelConfig().model;
