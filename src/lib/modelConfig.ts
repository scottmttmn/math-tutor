import type { ModelConfig } from '@/types';

const STORAGE_KEY = 'mathTutor_modelConfig';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

const DEFAULT_CONFIG: ModelConfig = {
  provider: 'anthropic',
  model: DEFAULT_ANTHROPIC_MODEL,
  baseUrl: '',
};

export function getModelConfig(): ModelConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const config: ModelConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    // Upgrade the former default in saved settings as well as new sessions.
    if (config.provider === 'anthropic' && config.model === 'claude-sonnet-4-5-20250929') {
      config.model = DEFAULT_ANTHROPIC_MODEL;
    }
    return config;
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
