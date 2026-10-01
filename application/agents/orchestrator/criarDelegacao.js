import { definirFerramenta, resultadoOk, resultadoErro } from '../runtime/definirFerramenta.js';
import { criarTarefa, transicionar, ESTADOS_TAREFA } from '../../../domain/a2a/Task.js';
import { mensagemUsuario, extrairTexto } from '../../../domain/a2a/Message.js';

// Constroi as ferramentas de delegacao do orquestrador A PARTIR DOS AGENT
// CARDS do registry.
//
// E o ponto em que o sistema deixa de ser "um agente com muitas ferramentas"
// e vira multiagente de verdade: o orquestrador nao conhece `analista` nem
// `redator` - ele conhece "os agentes que o registry publica". Registrar um
// agente novo (local ou remoto, deste time ou de outro) faz a ferramenta de
// delegacao aparecer sozinha, com a descricao e os exemplos que o proprio
// card declara.
//
// Cada delegacao abre uma SUB-TAREFA A2A no mesmo `contextId` da conversa,
// com `parentTaskId` no metadata. E o que torna possivel, depois, reconstruir
// "o orquestrador perguntou X ao analista, que respondeu Y" no tracing.

function descreverCard(card) {
  const linhas = [card.description];

  if (card.skills?.length) {
    linhas.push('Competências:');
    for (const skill of card.skills) {
      linhas.push(`- ${skill.name}: ${skill.description}`);
      if (skill.examples?.length) {
        linhas.push(`  Exemplos de pedido: ${skill.examples.map(e => `"${e}"`).join('; ')}`);
      }
    }
  }

  if (card.capabilities?.escrita) {
    linhas.push(
      'Atenção: este agente pode propor alterações de dados. As propostas voltam para você e ' +
      'precisam ser confirmadas pelo usuário antes de qualquer gravação.'
    );
  }

  return linhas.join('\n');
}

export function criarFerramentasDeDelegacao({ agentRegistry, orquestradorId, tarefaRepository, tracer }) {
  const cards = agentRegistry.listarDelegaveis(orquestradorId);

  return cards.map(card => definirFerramenta({
    nome: `delegar_${card.id}`,
    descricao: `Delega um pedido para o agente "${card.name}".\n${descreverCard(card)}`,
    parametros: {
      type: 'object',
      properties: {
        pedido: {
          type: 'string',
          description:
            'O pedido para o especialista, em português, completo e autossuficiente. Ele NÃO vê a ' +
            'conversa com o usuário: inclua período, projeto e formato quando forem relevantes.'
        }
      },
      required: ['pedido']
    },
    executar: async ({ pedido }, contexto) => {
      if (!pedido || !pedido.trim()) {
        return resultadoErro(`Delegação para "${card.id}" exige um pedido não vazio.`);
      }

      const agente = agentRegistry.obter(card.id);
      const mensagem = mensagemUsuario(pedido, { contextId: contexto.contextId });

      let subTarefa = criarTarefa({
        contextId: contexto.contextId,
        agentId: card.id,
        userId: contexto.userId,
        mensagemInicial: mensagem,
        metadata: { parentTaskId: contexto.taskId, delegadoPor: orquestradorId }
      });
      subTarefa = transicionar(subTarefa, ESTADOS_TAREFA.TRABALHANDO);
      await tarefaRepository.salvar(subTarefa);

      const span = tracer.iniciarSpan({
        contextId: contexto.contextId,
        nome: `delegar:${card.id}`,
        tipo: 'delegacao',
        atributos: { subTaskId: subTarefa.id }
      });

      try {
        let texto;
        let propostas = [];

        if (agente.transporte === 'http') {
          // Agente remoto: devolve uma Task A2A completa.
          const tarefaRemota = await agente.cliente.enviarMensagem({
            mensagem,
            taskId: subTarefa.id,
            contextId: contexto.contextId,
            userId: contexto.userId
          });
          texto = extrairTexto(tarefaRemota?.status?.message) || '';
          propostas = tarefaRemota?.metadata?.propostasPendentes || [];
        } else {
          const saida = await agente.executar({
            tarefa: subTarefa,
            mensagem,
            contexto: { userId: contexto.userId },
            contextId: contexto.contextId,
            openAiConfig: contexto.openAiConfig
          });
          texto = saida?.texto || '';
          propostas = saida?.propostas || [];
        }

        const concluida = transicionar(subTarefa, ESTADOS_TAREFA.CONCLUIDA);
        await tarefaRepository.salvar(concluida);
        span.finalizar({ status: 'ok', atributos: { propostas: propostas.length } });

        return resultadoOk({
          agente: card.id,
          resposta: texto,
          // Nome distinto de `proposta` (singular): o AgentRuntime trata os
          // dois, mas so este carrega propostas vindas de OUTRO agente, e
          // manter separado deixa o trace legivel.
          propostasDelegadas: propostas,
          instrucao: propostas.length
            ? 'O especialista preparou alterações que exigem confirmação. Apresente-as ao usuário e peça o aceite. NÃO afirme que algo foi gravado.'
            : 'Use esta resposta para compor a sua. Não invente dados além do que veio aqui.'
        });
      } catch (e) {
        span.finalizar({ status: 'erro', erro: e });
        const falhou = transicionar(subTarefa, ESTADOS_TAREFA.FALHOU);
        await tarefaRepository.salvar(falhou).catch(() => {});
        return resultadoErro(
          `O agente "${card.name}" falhou: ${e.message}`,
          { sugestao: 'Diga ao usuário que essa parte não pôde ser consultada. Não invente o conteúdo.' }
        );
      }
    }
  }));
}
