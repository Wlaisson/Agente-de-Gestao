// Portado verbatim de DELETE /api/atividades/:id.
export function makeExcluirAtividadeUseCase({ atividadeRepository }) {
  return async function excluirAtividade({ id, userId }) {
    const { error } = await atividadeRepository.excluir(id, userId);
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }
  };
}
