// Persistencia das tarefas A2A.
//
// Segue a mesma postura do resto do projeto para features que dependem de
// uma migration manual (ver o topo de schema-embeddings.sql): se a tabela
// ainda nao existe no ambiente, NAO derruba o fluxo do usuario - degrada
// para memoria e avisa uma vez no log.
//
// A consequencia de rodar em memoria e clara e vale registrar: a conversa
// nao sobrevive a um restart nem e compartilhada entre instancias
// serverless. Numa Vercel com varias instancias, uma confirmacao pode cair
// numa instancia que nao conhece a proposta - por isso schema-a2a.sql deve
// ser aplicado antes de uso real, e o aviso abaixo e propositalmente
// barulhento.

const TABELA = 'a2a_tarefas';

function tabelaAusente(error) {
  if (!error) return false;
  // PGRST205/42P01: relacao inexistente no schema cache do PostgREST.
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /could not find the table|relation .* does not exist/i.test(error.message || '');
}

function tarefaParaLinha(tarefa) {
  return {
    id: tarefa.id,
    context_id: tarefa.contextId,
    agent_id: tarefa.agentId,
    user_id: tarefa.userId,
    estado: tarefa.status.state,
    status: tarefa.status,
    history: tarefa.history,
    artifacts: tarefa.artifacts,
    metadata: tarefa.metadata,
    criado_em: tarefa.criadoEm,
    atualizado_em: tarefa.atualizadoEm
  };
}

function linhaParaTarefa(linha) {
  return {
    id: linha.id,
    contextId: linha.context_id,
    agentId: linha.agent_id,
    userId: linha.user_id,
    status: linha.status,
    history: linha.history || [],
    artifacts: linha.artifacts || [],
    metadata: linha.metadata || {},
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em
  };
}

export function createSupabaseTarefaA2ARepository({ supabaseAdmin, limiteMemoria = 500 }) {
  const memoria = new Map();
  let usandoMemoria = false;

  function avisarUmaVez(motivo) {
    if (usandoMemoria) return;
    usandoMemoria = true;
    console.warn(
      `[a2a] Tabela "${TABELA}" indisponível (${motivo}). As tarefas do agente ficarão APENAS em ` +
      'memória: não sobrevivem a restart nem são compartilhadas entre instâncias. ' +
      'Aplique schema-a2a.sql no Supabase para persistir.'
    );
  }

  function salvarEmMemoria(tarefa) {
    memoria.set(tarefa.id, tarefa);
    if (memoria.size > limiteMemoria) {
      memoria.delete(memoria.keys().next().value);
    }
    return tarefa;
  }

  return {
    async salvar(tarefa) {
      if (usandoMemoria) return salvarEmMemoria(tarefa);

      try {
        const { error } = await supabaseAdmin.from(TABELA).upsert(tarefaParaLinha(tarefa));
        if (error) {
          if (tabelaAusente(error)) {
            avisarUmaVez(error.message);
            return salvarEmMemoria(tarefa);
          }
          // Erro real de escrita (permissao, constraint): nao silenciar, mas
          // tambem nao derrubar a conversa em andamento.
          console.error('[a2a] Falha ao persistir tarefa:', error.message);
          return salvarEmMemoria(tarefa);
        }
        // Espelho em memoria: leitura imediata apos escrita nao depende de
        // ida ao banco e evita condicao de corrida dentro da mesma request.
        memoria.set(tarefa.id, tarefa);
        return tarefa;
      } catch (e) {
        avisarUmaVez(e.message);
        return salvarEmMemoria(tarefa);
      }
    },

    async obter(taskId) {
      if (!taskId) return null;
      if (memoria.has(taskId)) return memoria.get(taskId);
      if (usandoMemoria) return null;

      try {
        const { data, error } = await supabaseAdmin.from(TABELA).select('*').eq('id', taskId).single();
        if (error) {
          if (tabelaAusente(error)) avisarUmaVez(error.message);
          return null;
        }
        return data ? linhaParaTarefa(data) : null;
      } catch (e) {
        avisarUmaVez(e.message);
        return null;
      }
    },

    // Historico da conversa (todas as tarefas de um mesmo contexto), usado
    // pela UI para reabrir um fio anterior.
    async listarPorContexto(contextId, userId) {
      if (usandoMemoria) {
        return [...memoria.values()]
          .filter(t => t.contextId === contextId && t.userId === userId)
          .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
      }

      try {
        const { data, error } = await supabaseAdmin
          .from(TABELA)
          .select('*')
          .eq('context_id', contextId)
          .eq('user_id', userId)
          .order('criado_em', { ascending: true });
        if (error) {
          if (tabelaAusente(error)) avisarUmaVez(error.message);
          return [];
        }
        return (data || []).map(linhaParaTarefa);
      } catch (e) {
        avisarUmaVez(e.message);
        return [];
      }
    }
  };
}
