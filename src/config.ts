export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (máxima precisão)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (equilíbrio)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (rápido / barato)' },
] as const;
export const DEFAULT_MODEL = 'claude-opus-5-5';

export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];
