import { mapearPayloadAtualizacao } from '../../../interface-adapters/mappers/AtividadePayloadMapper.js';
import { tentarGerarEmbedding } from '../../../shared/embeddingHelpers.js';

// Portado verbatim de PUT /api/atividades/:id.
export function makeAtualizarAtividadeUseCase({ atividadeRepository, openAIGateway, embeddingsGateway }) {
  return async function atualizarAtividade({ id, userId, body }) {
    const dados = mapearPayloadAtualizacao(body || {});

    // So recalcula o embedding se o texto que ele descreve realmente mudou -
    // evita uma chamada de API desperdicada em updates que so tocam
    // tempo/classificacao/etc. Usa so o que veio no body (update parcial);
    // nao le o valor atual do outro campo do banco para nao gastar uma
    // leitura extra so por causa disso.
    if (dados.titulo !== undefined || dados.atividade !== undefined) {
      dados.embedding = await tentarGerarEmbedding({
        openAIGateway,
        embeddingsGateway,
        userId,
        texto: `${dados.titulo || ''}\n${dados.atividade || ''}`
      });
    }

    const { error } = await atividadeRepository.atualizar(id, userId, dados);
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }
  };
}
