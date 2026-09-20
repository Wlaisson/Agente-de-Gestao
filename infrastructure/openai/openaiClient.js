import OpenAI from 'openai';

export const openaiGlobal = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const MODELOS = [
  process.env.OPENAI_MODEL || 'gpt-5-nano',
  'gpt-4o-mini'
];

// 1536 dimensoes - bate com a coluna `vector(1536)` criada por schema-embeddings.sql.
export const MODELO_EMBEDDING = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
