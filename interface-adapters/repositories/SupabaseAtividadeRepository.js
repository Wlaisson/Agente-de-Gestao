// A coluna `embedding` (vector) e adicionada por schema-embeddings.sql, que
// precisa ser rodado manualmente no Supabase (nao ha migracao automatica
// neste projeto - ver nota no topo daquele arquivo). Enquanto isso nao roda
// em algum ambiente, o Postgrest recusa qualquer insert/update que cite
// `embedding` com PGRST204 ("Could not find the 'embedding' column ... in
// the schema cache"), o que travava POST/PUT /api/atividades inteiro so
// porque o campo auxiliar de busca semantica nao tinha onde ser gravado -
// contrariando a premissa do resto do fluxo (embeddingHelpers.js) de que
// uma falha nessa feature auxiliar nunca deve bloquear a escrita principal.
function erroColunaEmbeddingAusente(error) {
  return !!error && error.code === 'PGRST204' && /embedding/i.test(error.message || '');
}

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

    async upsert(registro) {
      const resultado = await supabaseAdmin.from('atividades').upsert(registro);
      if (erroColunaEmbeddingAusente(resultado.error)) {
        const { embedding, ...semEmbedding } = registro;
        return supabaseAdmin.from('atividades').upsert(semEmbedding);
      }
      return resultado;
    },

    async atualizar(id, userId, dados) {
      const construirQuery = (dadosQuery) => {
        let query = supabaseAdmin.from('atividades').update(dadosQuery).eq('id', id);
        if (userId) query = query.eq('user_id', userId);
        return query;
      };

      const resultado = await construirQuery(dados);
      if (erroColunaEmbeddingAusente(resultado.error)) {
        const { embedding, ...semEmbedding } = dados;
        return construirQuery(semEmbedding);
      }
      return resultado;
    },

    excluir(id, userId) {
      let query = supabaseAdmin.from('atividades').delete().eq('id', id);
      if (userId) query = query.eq('user_id', userId);
      return query;
    },

    // Usada pelos relatorios semanais: mesma query do server.js original
    // (sem .order(), diferente de listar() acima - preservado verbatim).
    listarPorSemana(userId, semana) {
      let query = supabaseAdmin.from('atividades').select('*').eq('semana', semana);
      if (userId) query = query.eq('user_id', userId);
      return query;
    },

    // Busca semantica via pgvector (schema-embeddings.sql). match_atividades
    // ja filtra `embedding is not null`, entao linhas antigas sem embedding
    // (gravadas antes desta feature) simplesmente nao aparecem no resultado.
    buscarSimilares(embeddingConsulta, { userId, limite = 5 } = {}) {
      return supabaseAdmin.rpc('match_atividades', {
        query_embedding: embeddingConsulta,
        match_count: limite,
        match_user_id: userId || null
      });
    }
  };
}
