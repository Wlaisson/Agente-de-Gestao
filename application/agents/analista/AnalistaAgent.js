import { criarAgentCard } from '../../../domain/a2a/AgentCard.js';
import { criarAgenteLlm } from '../runtime/criarAgenteLlm.js';
import { montarSystemPromptConversacional } from '../../../shared/promptBuilderConversacional.js';
import {
  ANALISTA_PERSONA,
  ANALISTA_NEGATIVAS,
  ANALISTA_EXEMPLOS,
  ANALISTA_FORMATO
} from './analistaPromptConfig.js';

// Especialista em consulta e medicao. Somente leitura - `escrita: false` no
// card e o que o orquestrador usa para saber que delegar para ca nunca exige
// confirmacao do usuario.
export const CARD_ANALISTA = criarAgentCard({
  id: 'analista',
  name: 'Analista de Atividades',
  description:
    'Consulta as atividades registradas pelo usuário e calcula tempos. Responde o que foi feito, ' +
    'quanto tempo foi gasto, em quais projetos e assuntos, em qualquer período. Use para perguntas ' +
    'sobre dados já registrados.',
  capabilities: { streaming: false, pushNotifications: false, escrita: false },
  skills: [
    {
      id: 'consultar-tempo',
      name: 'Consulta de tempo gasto',
      description: 'Soma exata do tempo gasto por projeto, assunto ou classificação em um período.',
      tags: ['tempo', 'metricas', 'projeto'],
      examples: [
        'quanto tempo gastei essa semana com a RedePRO?',
        'quantas horas na Tracbel em setembro?',
        'me quebra o tempo da semana por projeto'
      ]
    },
    {
      id: 'consultar-atividades',
      name: 'Consulta de atividades',
      description: 'Lista o que foi realizado em um período, com filtros por projeto e assunto.',
      tags: ['atividades', 'historico'],
      examples: [
        'o que eu fiz essa semana?',
        'o que foi desenvolvido na Imdepa esse mês?',
        'quando foi que eu mexi com o scraping do Prosis?'
      ]
    }
  ]
});

export function criarAnalistaAgent({ ferramentas, agentRuntime }) {
  return criarAgenteLlm({
    card: CARD_ANALISTA,
    ferramentas,
    agentRuntime,
    montarPrompt: async () => montarSystemPromptConversacional({
      persona: ANALISTA_PERSONA,
      negativas: ANALISTA_NEGATIVAS,
      poucosExemplos: ANALISTA_EXEMPLOS,
      ferramentas,
      formatoResposta: ANALISTA_FORMATO,
      contextoOperacional: `Data de hoje: ${new Date().toISOString().slice(0, 10)}.`
    })
  });
}
