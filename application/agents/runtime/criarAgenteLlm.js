import { extrairTexto, extrairDados } from '../../../domain/a2a/Message.js';

// Fabrica o handler `executar` de um agente que roda o laco LLM+ferramentas.
//
// Todos os especialistas (e o orquestrador) sao a mesma maquina com prompt e
// ferramentas diferentes. Centralizar aqui garante que a reconstrucao do
// historico, o corte de contexto e o formato de retorno sejam identicos em
// todos - divergencia nesse ponto e fonte classica de "funciona num agente e
// no outro nao".
//
// Retorno: { texto, dados, propostas, truncado } - o contrato que o
// TaskManager espera para decidir entre `completed` e `input-required`.

// Quantas mensagens do historico da tarefa entram no prompt. Conversa longa
// estoura contexto e custo; as ultimas trocas sao o que importa para
// continuidade.
const MAX_MENSAGENS_HISTORICO = 12;

export function criarAgenteLlm({
  card,
  montarPrompt,
  ferramentas,
  agentRuntime,
  maxTokens = 3000,
  maxIteracoes = 8
}) {
  function reconstruirMensagens(tarefa, mensagemAtual) {
    const historico = (tarefa?.history || [])
      .slice(-MAX_MENSAGENS_HISTORICO)
      // A mensagem atual ja foi anexada ao historico pelo TaskManager;
      // inclui-la de novo faria o modelo ver a pergunta duplicada.
      .filter(m => m.messageId !== mensagemAtual.messageId)
      .map(m => ({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content: extrairTexto(m) || '(sem texto)'
      }))
      .filter(m => m.content !== '(sem texto)');

    const dadosAtuais = extrairDados(mensagemAtual);
    let conteudoAtual = extrairTexto(mensagemAtual);
    if (dadosAtuais && Object.keys(dadosAtuais).length > 0) {
      // Dados estruturados que a UI mandou junto (ex.: a semana selecionada
      // na tela) entram como contexto explicito em vez de sumirem.
      conteudoAtual += `\n\n[Contexto enviado pela interface: ${JSON.stringify(dadosAtuais)}]`;
    }

    return [...historico, { role: 'user', content: conteudoAtual.trim() || '(sem conteúdo)' }];
  }

  async function executar({ tarefa, mensagem, contexto, contextId, openAiConfig }) {
    const systemPrompt = await montarPrompt({ contexto, tarefa });

    // As ferramentas de dominio so precisam de `userId`. As de DELEGACAO
    // precisam abrir sub-tarefas no mesmo contexto e repassar a config da
    // OpenAI ao especialista - por isso o contexto enriquecido. Nada disso
    // aparece no schema exposto ao modelo: continua sendo estado do
    // servidor, inacessivel ao prompt.
    const contextoCompleto = {
      ...contexto,
      contextId,
      taskId: tarefa?.id || null,
      openAiConfig
    };

    const resultado = await agentRuntime.executar({
      agentId: card.id,
      systemPrompt,
      mensagens: reconstruirMensagens(tarefa, mensagem),
      ferramentas,
      contexto: contextoCompleto,
      contextId,
      openAiConfig,
      maxTokens,
      maxIteracoes
    });

    return {
      texto: resultado.texto,
      dados: { ferramentasUsadas: resultado.ferramentasChamadas, agente: card.id },
      propostas: resultado.propostas,
      truncado: resultado.truncado
    };
  }

  return { card, executar };
}
