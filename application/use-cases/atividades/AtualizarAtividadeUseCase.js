import { mapearPayloadAtualizacao } from '../../../interface-adapters/mappers/AtividadePayloadMapper.js';

// Portado verbatim de PUT /api/atividades/:id.
export function makeAtualizarAtividadeUseCase({ atividadeRepository }) {
  return async function atualizarAtividade({ id, userId, body }) {
    const dados = mapearPayloadAtualizacao(body || {});

    const { error } = await atividadeRepository.atualizar(id, userId, dados);
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }
  };
}
