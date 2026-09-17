// Portado verbatim de DELETE /api/admin/usuarios/:id em server.js: nenhum dos
// dois awaits verifica erro (so exceptions inesperadas sao tratadas pelo
// controller) - mesmo comportamento de antes, incluindo a ausencia de rollback.
export function makeExcluirUsuarioUseCase({ usuarioRepository }) {
  return async function excluirUsuario(id) {
    await usuarioRepository.excluirUsuarioAuth(id);
    await usuarioRepository.excluirPorId(id);
  };
}
