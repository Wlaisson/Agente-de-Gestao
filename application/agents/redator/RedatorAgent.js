import { criarAgentCard } from '../../../domain/a2a/AgentCard.js';
import { criarAgenteLlm } from '../runtime/criarAgenteLlm.js';
import { montarSystemPromptConversacional } from '../../../shared/promptBuilderConversacional.js';
import {
  REDATOR_PERSONA,
  REDATOR_NEGATIVAS,
  REDATOR_EXEMPLOS,
  REDATOR_FORMATO,
  ESPECIFICACAO_FORMATOS
} from './redatorPromptConfig.js';

export const CARD_REDATOR = criarAgentCard({
  id: 'redator',
  name: 'Redator de Apresentações e Relatórios',
  description:
    'Gera o texto pronto para colar em apresentações de status e relatórios a partir das atividades registradas. ' +
    'Conhece os formatos "Weekly Conteúdo Técnico" (card por cliente), "AI Estratégica" (slide ' +
    'Agentes de Catálogo) e "Resumo da Semana por Assunto" (resumo semanal executivo/formal para envio de sexta-feira, separado por tópicos de cada assunto, focado estritamente em desenvolvimento e construção, excluindo reuniões e atualização de apresentação). Use quando o usuário pedir texto para slide, weekly, status report, resumo da semana por assunto ou resumo de sexta-feira.',
  capabilities: { streaming: false, pushNotifications: false, escrita: false },
  skills: [
    {
      id: 'weekly-tecnico',
      name: 'Weekly Conteúdo Técnico',
      description:
        'Monta o card semanal de um cliente: resumo da semana no padrão "[Categoria]: texto", ' +
        'indicadores, próximas etapas e pontos de atenção.',
      tags: ['apresentacao', 'weekly', 'cliente', 'status-report'],
      examples: [
        'gera o texto do weekly da RedePRO dessa semana',
        'monta o resumo da semana da Imdepa',
        'preciso do status report da Tracbel'
      ]
    },
    {
      id: 'ai-estrategica',
      name: 'AI Estratégica — Agentes de Catálogo',
      description:
        'Monta o slide de Agentes de Catálogo: tabela Iniciativa/Responsável/Status/Prazo, ' +
        'próximos passos e definições e pendências.',
      tags: ['apresentacao', 'ai-estrategica', 'agentes', 'catalogo'],
      examples: [
        'monta o slide de agentes de catálogo',
        'atualiza a tabela da AI estratégica',
        'quais os próximos passos pro slide de IA?'
      ]
    },
    {
      id: 'resumo-semana-assunto',
      name: 'Resumo da Semana por Assunto (Sexta-feira)',
      description:
        'Monta o resumo semanal consolidado por tópicos de cada assunto (assuntos internos, Rede Pró, Agrominas, etc.) para envio de sexta-feira. Inclui SOMENTE desenvolvimento e construção, excluindo reuniões e atualização de apresentação.',
      tags: ['resumo-semana', 'assunto', 'sexta-feira', 'desenvolvimento', 'relatorio'],
      examples: [
        'gera o resumo da semana',
        'resumo da semana por assunto',
        'monta o resumo de sexta-feira',
        'resumo semanal para envio'
      ]
    }
  ]
});


export function criarRedatorAgent({ ferramentas, agentRuntime, obterPerfilUsuario = null }) {
  return criarAgenteLlm({
    card: CARD_REDATOR,
    ferramentas,
    agentRuntime,
    // Slides costumam ser longos (tabela + tres blocos de bullets); o teto
    // padrao de 3000 trunca o texto no meio da tabela.
    maxTokens: 4000,
    montarPrompt: async ({ contexto }) => {
      const linhasContexto = [`Data de hoje: ${new Date().toISOString().slice(0, 10)}.`];

      // O slide da AI Estrategica tem coluna "Responsavel". Sem o nome, o
      // agente deixaria um placeholder que o usuario teria que editar a mao -
      // exatamente o retrabalho que este sistema existe para eliminar.
      if (obterPerfilUsuario) {
        try {
          const perfil = await obterPerfilUsuario(contexto.userId);
          if (perfil?.nome_pdf) {
            linhasContexto.push(`Nome do usuário (use como "Responsável"): ${perfil.nome_pdf}.`);
          }
          if (perfil?.empresa_pdf) {
            linhasContexto.push(`Empresa: ${perfil.empresa_pdf}.`);
          }
        } catch (e) {
          console.log('Perfil aviso:', e.message);
        }
      }

      return montarSystemPromptConversacional({
        persona: REDATOR_PERSONA,
        negativas: REDATOR_NEGATIVAS,
        poucosExemplos: REDATOR_EXEMPLOS,
        ferramentas,
        contextoOperacional: `${linhasContexto.join('\n')}\n\n${ESPECIFICACAO_FORMATOS}`,
        formatoResposta: REDATOR_FORMATO
      });
    }
  });
}
