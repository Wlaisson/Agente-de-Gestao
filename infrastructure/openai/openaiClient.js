import OpenAI from 'openai';

export const openaiGlobal = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const MODELOS = [
  process.env.OPENAI_MODEL || 'gpt-5-nano',
  'gpt-4o-mini'
];
