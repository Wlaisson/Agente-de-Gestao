// Envolve resolucao de cliente + geracao de embedding num try/catch unico.
// Nunca bloqueia a escrita/geracao principal - mesmo padrao ja usado para o
// espelho fire-and-forget do webhook legado (GoogleSheetsWebhookGateway.js):
// uma falha aqui e uma preocupacao auxiliar, nao motivo para falhar a
// requisicao do usuario.
export async function tentarGerarEmbedding({ openAIGateway, embeddingsGateway, userId, texto }) {
  try {
    const { openai } = await openAIGateway.obterCliente(userId);
    return await embeddingsGateway.gerarEmbedding({ openai, texto });
  } catch (e) {
    console.log('Embeddings aviso:', e.message);
    return null;
  }
}

// Mesma ideia para a busca semantica: uma falha na busca de contexto nunca
// deve impedir a geracao da resposta de IA em si - so degrada para "sem
// contexto adicional" (string vazia).
export async function tentarBuscarContextoRag(buscarFn) {
  try {
    return await buscarFn();
  } catch (e) {
    console.log('Busca RAG aviso:', e.message);
    return '';
  }
}
