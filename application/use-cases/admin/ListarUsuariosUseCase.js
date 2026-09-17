// Portado verbatim de GET /api/admin/usuarios em server.js.
export function makeListarUsuariosUseCase({ usuarioRepository }) {
  return async function listarUsuarios() {
    const { data, error } = await usuarioRepository.listarTodos();

    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }

    return data;
  };
}
