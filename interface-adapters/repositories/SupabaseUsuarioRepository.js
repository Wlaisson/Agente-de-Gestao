// Encapsula todo acesso a tabela `usuarios` + Supabase Auth admin usado pelos
// dominios Auth/Admin. Portado verbatim de server.js (mesmas queries, mesmos
// clientes: `supabase` anonimo para signIn, `supabaseAdmin` para tudo o resto).
export function createSupabaseUsuarioRepository({ supabase, supabaseAdmin }) {
  return {
    autenticarComEmailSenha(email, password) {
      return supabase.auth.signInWithPassword({ email, password });
    },

    buscarPorId(id) {
      return supabaseAdmin
        .from('usuarios')
        .select('id, email, nome, is_admin, permissoes')
        .eq('id', id)
        .single();
    },

    listarTodos() {
      return supabaseAdmin
        .from('usuarios')
        .select('id, email, nome, is_admin, permissoes, created_at')
        .order('created_at', { ascending: false });
    },

    inserir(usuario) {
      return supabaseAdmin.from('usuarios').insert(usuario);
    },

    excluirPorId(id) {
      return supabaseAdmin.from('usuarios').delete().eq('id', id);
    },

    criarUsuarioAuth({ email, password, nome }) {
      return supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome: nome || '' }
      });
    },

    excluirUsuarioAuth(id) {
      return supabaseAdmin.auth.admin.deleteUser(id);
    }
  };
}
