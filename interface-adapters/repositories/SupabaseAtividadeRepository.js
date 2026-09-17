// Portado verbatim das queries de /api/atividades em server.js.
export function createSupabaseAtividadeRepository({ supabaseAdmin }) {
  return {
    listar({ userId, todos, semana, start, end }) {
      let query = supabaseAdmin
        .from('atividades')
        .select('*')
        .order('data', { ascending: false })
        .order('created_at', { ascending: false });

      if (todos !== 'true') {
        query = query.eq('user_id', userId);
      }
      if (semana) {
        query = query.eq('semana', semana);
      }
      if (start && end) {
        query = query.gte('data', start).lte('data', end);
      }

      return query;
    },

    upsert(registro) {
      return supabaseAdmin.from('atividades').upsert(registro);
    },

    atualizar(id, userId, dados) {
      let query = supabaseAdmin.from('atividades').update(dados).eq('id', id);
      if (userId) query = query.eq('user_id', userId);
      return query;
    },

    excluir(id, userId) {
      let query = supabaseAdmin.from('atividades').delete().eq('id', id);
      if (userId) query = query.eq('user_id', userId);
      return query;
    }
  };
}
