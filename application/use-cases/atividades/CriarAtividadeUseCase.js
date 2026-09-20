import { mapearPayloadCriacao } from '../../../interface-adapters/mappers/AtividadePayloadMapper.js';
import { WEBHOOK_URL } from '../../../config/env.js';
import { tentarGerarEmbedding } from '../../../shared/embeddingHelpers.js';

// Portado verbatim de POST /api/atividades: upsert no Supabase + espelho
// fire-and-forget para o webhook legado do Google Sheets (erro so logado,
// nunca falha a requisicao - mesmo comportamento de antes).
export function makeCriarAtividadeUseCase({ atividadeRepository, openAIGateway, embeddingsGateway }) {
  return async function criarAtividade({ userId, body }) {
    if (!userId) {
      const erro = new Error('Usuário não autenticado.');
      erro.status = 401;
      throw erro;
    }

    const registro = mapearPayloadCriacao(body || {}, userId);

    // Embedding so na linha enviada ao Supabase, nunca no objeto retornado
    // (mantem o contrato de resposta do endpoint identico). Falha aqui nunca
    // bloqueia a escrita principal - mesma postura do espelho do webhook
    // logo abaixo.
    const registroComEmbedding = {
      ...registro,
      embedding: await tentarGerarEmbedding({
        openAIGateway,
        embeddingsGateway,
        userId,
        texto: `${registro.titulo}\n${registro.atividade}`
      })
    };

    const { error } = await atividadeRepository.upsert(registroComEmbedding);
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }

    try {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          id: registro.id,
          data: registro.data,
          semana: registro.semana,
          projeto: registro.projeto,
          assuntoInterno: registro.assunto_interno,
          titulo: registro.titulo,
          atividade: registro.atividade,
          tempo: registro.tempo,
          classNivel1: registro.class_nivel_1,
          classNivel2: registro.class_nivel_2
        })
      }).catch(e => console.log('Sheets fallback aviso:', e.message));
    } catch (sheetErr) {
      console.log('Sheets fallback aviso:', sheetErr.message);
    }

    return registro;
  };
}
