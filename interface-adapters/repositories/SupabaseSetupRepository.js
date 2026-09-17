// Portado verbatim das queries de /api/setup em server.js.
export function createSupabaseSetupRepository({ supabaseAdmin }) {
  return {
    buscarCamposPublicos(userId) {
      return supabaseAdmin
        .from('setup_usuario')
        .select('openai_api_key, openai_model, nome_pdf, empresa_pdf, descricao_pdf, contato_pdf, logo_url')
        .eq('user_id', userId)
        .single();
    },

    buscarCompleto(userId) {
      return supabaseAdmin
        .from('setup_usuario')
        .select('*')
        .eq('user_id', userId)
        .single();
    },

    upsert(dados) {
      return supabaseAdmin.from('setup_usuario').upsert(dados);
    }
  };
}
