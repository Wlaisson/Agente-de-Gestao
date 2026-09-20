import { MODELO_EMBEDDING } from '../../infrastructure/openai/openaiClient.js';

// Gateway irmao de OpenAIGateway.js (nao dentro dele): embeddings sao uma 4a
// superficie da SDK (openai.embeddings.create), com formato de chamada
// diferente de chat/transcricao e sem a escada de fallback de modelos.
// Segue a mesma convencao de erro que chamarModelo/transcreverAudio: lanca
// em falha, quem chama decide como degradar (ver shared/embeddingHelpers.js).
export function createEmbeddingsGateway({ modeloEmbedding }) {
  async function gerarEmbedding({ openai, texto }) {
    if (!texto || !texto.trim()) return null;
    const resposta = await openai.embeddings.create({
      model: modeloEmbedding,
      input: texto.slice(0, 8000) // guarda contra input excessivo
    });
    return resposta.data[0].embedding;
  }

  return { gerarEmbedding };
}

export const embeddingsGateway = createEmbeddingsGateway({ modeloEmbedding: MODELO_EMBEDDING });
