// Logica portada verbatim de POST /api/auth/login em server.js. Erros de
// negocio carregam `status` para o controller decidir o codigo HTTP, sem
// acoplar esta camada ao Express.
export function makeAutenticarUsuarioUseCase({ usuarioRepository }) {
  return async function autenticarUsuario({ email, password }) {
    const { data: authData, error: authError } = await usuarioRepository.autenticarComEmailSenha(
      email.trim(),
      password
    );

    if (authError || !authData.user) {
      const erro = new Error(authError ? authError.message : 'Credenciais inválidas.');
      erro.status = 401;
      throw erro;
    }

    const { data: usuario, error: userError } = await usuarioRepository.buscarPorId(authData.user.id);

    if (userError || !usuario) {
      const erro = new Error('Usuário não cadastrado na base de acesso.');
      erro.status = 403;
      throw erro;
    }

    return { session: authData.session, user: usuario };
  };
}
