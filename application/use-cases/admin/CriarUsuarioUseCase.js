// Portado verbatim de POST /api/admin/usuarios em server.js, incluindo a
// compensacao manual (deleta o auth user recem-criado se o insert em
// `usuarios` falhar) - nao e uma transacao atomica, mesmo comportamento de antes.
export function makeCriarUsuarioUseCase({ usuarioRepository }) {
  return async function criarUsuario({ email, password, nome, permissoes }) {
    const { data: createData, error: createError } = await usuarioRepository.criarUsuarioAuth({
      email: email.trim(),
      password,
      nome
    });

    if (createError) {
      const erro = new Error(createError.message);
      erro.status = 400;
      throw erro;
    }

    const novoUsuario = {
      id: createData.user.id,
      email: createData.user.email,
      nome: nome || '',
      is_admin: false,
      permissoes: permissoes || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: dbError } = await usuarioRepository.inserir(novoUsuario);

    if (dbError) {
      await usuarioRepository.excluirUsuarioAuth(createData.user.id);
      const erro = new Error(dbError.message);
      erro.status = 500;
      throw erro;
    }

    return novoUsuario;
  };
}
