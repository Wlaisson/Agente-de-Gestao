// Trilha de auditoria das acoes do agente.
//
// Registra tanto o que foi PROPOSTO quanto o que foi EXECUTADO. Os dois
// importam: uma proposta recusada e a evidencia de que o sistema sugeriu
// algo errado, e e o que permite ajustar o prompt depois. So logar execucoes
// esconderia metade dos problemas.
//
// Nunca lanca: auditoria que derruba a operacao auditada troca um problema
// de rastreabilidade por um problema de disponibilidade.

const TABELA = 'a2a_auditoria';

function tabelaAusente(error) {
  if (!error) return false;
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /could not find the table|relation .* does not exist/i.test(error.message || '');
}

export function createSupabaseAuditoriaRepository({ supabaseAdmin, limiteMemoria = 300 }) {
  const memoria = [];
  let usandoMemoria = false;

  function avisarUmaVez(motivo) {
    if (usandoMemoria) return;
    usandoMemoria = true;
    console.warn(
      `[a2a] Tabela "${TABELA}" indisponível (${motivo}). A auditoria das ações do agente ficará ` +
      'apenas em memória. Aplique schema-a2a.sql no Supabase.'
    );
  }

  function registrarEmMemoria(registro) {
    memoria.push(registro);
    if (memoria.length > limiteMemoria) memoria.shift();
    return registro;
  }

  return {
    async registrar({ userId, contextId, acao, detalhes, executado }) {
      const registro = {
        user_id: userId,
        context_id: contextId,
        acao,
        detalhes,
        executado: !!executado,
        criado_em: new Date().toISOString()
      };

      if (usandoMemoria) return registrarEmMemoria(registro);

      try {
        const { error } = await supabaseAdmin.from(TABELA).insert(registro);
        if (error) {
          if (tabelaAusente(error)) {
            avisarUmaVez(error.message);
          } else {
            console.error('[a2a] Falha ao auditar:', error.message);
          }
          return registrarEmMemoria(registro);
        }
        return registro;
      } catch (e) {
        avisarUmaVez(e.message);
        return registrarEmMemoria(registro);
      }
    },

    async listar({ userId, limite = 50 }) {
      if (usandoMemoria) {
        return memoria.filter(r => r.user_id === userId).slice(-limite).reverse();
      }

      try {
        const { data, error } = await supabaseAdmin
          .from(TABELA)
          .select('*')
          .eq('user_id', userId)
          .order('criado_em', { ascending: false })
          .limit(limite);
        if (error) {
          if (tabelaAusente(error)) avisarUmaVez(error.message);
          return [];
        }
        return data || [];
      } catch (e) {
        avisarUmaVez(e.message);
        return [];
      }
    }
  };
}
