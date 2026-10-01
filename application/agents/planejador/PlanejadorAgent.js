import { criarAgentCard } from '../../../domain/a2a/AgentCard.js';
import { criarAgenteLlm } from '../runtime/criarAgenteLlm.js';
import { montarSystemPromptConversacional } from '../../../shared/promptBuilderConversacional.js';

export const CARD_PLANEJADOR = criarAgentCard({
  id: 'planejador',
  name: 'Planejador de Tarefas',
  description:
    'Cuida do quadro Kanban: mostra o que está pendente, atrasado ou em andamento, e prepara a ' +
    'criação e a movimentação de tarefas (sempre com confirmação do usuário). Use para perguntas ' +
    'sobre pendências, prazos e próximas etapas, e para pedidos de anotar ou concluir tarefa.',
  capabilities: { streaming: false, pushNotifications: false, escrita: true },
  skills: [
    {
      id: 'consultar-pendencias',
      name: 'Consulta de pendências e prazos',
      description: 'Lista tarefas por status, projeto ou situação de prazo (atrasadas, vencendo).',
      tags: ['kanban', 'tarefas', 'prazo'],
      examples: [
        'o que está pendente?',
        'tem alguma tarefa atrasada?',
        'quais as próximas etapas da Tracbel?'
      ]
    },
    {
      id: 'gerir-tarefas',
      name: 'Criação e movimentação de tarefas',
      description: 'Prepara criação de tarefa e mudança de status, sujeitas a confirmação do usuário.',
      tags: ['kanban', 'escrita'],
      examples: [
        'anota uma tarefa pra revisar o catálogo da Wurth até sexta',
        'marca a tarefa do scraping como concluída'
      ]
    }
  ]
});

const PLANEJADOR_PERSONA = `Você é o Planejador de Tarefas do WMA Report.

Sua função é dar visibilidade sobre o quadro Kanban do usuário e preparar mudanças nele.

Como trabalhar:
1. Para qualquer pergunta sobre pendências, chame listar_tarefas antes de responder.
2. Ao relatar prazos, use o campo "situacao" que a ferramenta devolve (atrasada, vence-hoje, vence-em-breve, no-prazo). Não calcule datas você mesmo.
3. Para criar ou mover tarefa, use as ferramentas propor_*. Elas não executam nada — devolvem uma proposta. Apresente a proposta ao usuário em uma frase clara e espere a confirmação dele.
4. Quando a ferramenta devolver "avisos", repasse-os: são as coisas que o usuário precisa saber antes de confirmar.
5. Se a tarefa citada for ambígua, liste as candidatas e pergunte. Nunca escolha por conta própria.

Tom: direto, de quem está olhando o quadro junto com a pessoa.`;

const PLANEJADOR_NEGATIVAS = [
  'Nunca diga que criou, moveu ou concluiu uma tarefa: você apenas propõe, quem aplica é o usuário ao confirmar.',
  'Nunca escolha entre tarefas parecidas por conta própria — pergunte.',
  'Nunca calcule atraso ou dias restantes você mesmo: use o campo "situacao" da ferramenta.',
  'Nunca cite uma tarefa que não veio de listar_tarefas nesta conversa.',
  'Ao citar tarefa marcada com semDonoRegistrado, avise que ela é anterior ao controle por usuário e pode não ser do usuário atual.'
];

const PLANEJADOR_EXEMPLOS = [
  {
    tipo: 'caminho feliz - consulta de pendencias',
    entrada: 'o que tá atrasado?',
    ferramentas: ['listar_tarefas'],
    saida:
      'Você tem 2 tarefas com prazo vencido:\n\n' +
      '- **Revisar catálogo Wurth** — venceu há 3 dias (projeto: Projetos - Wurth)\n' +
      '- **‹título›** — ‹situação devolvida pela ferramenta› (projeto: ‹projeto›)'
  },
  {
    tipo: 'escrita - proposta aguardando confirmacao',
    entrada: 'anota pra revisar o catálogo da Wurth até sexta',
    ferramentas: ['propor_criar_tarefa'],
    saida:
      'Preparei esta tarefa:\n\n' +
      '- **‹título›**\n' +
      '- Projeto: ‹projeto resolvido pela ferramenta›\n' +
      '- Prazo: ‹data resolvida pela ferramenta›\n' +
      '- Prioridade: ‹prioridade›\n\n' +
      'Confirma que posso criar?'
  }
];

export function criarPlanejadorAgent({ ferramentas, agentRuntime }) {
  return criarAgenteLlm({
    card: CARD_PLANEJADOR,
    ferramentas,
    agentRuntime,
    montarPrompt: async () => montarSystemPromptConversacional({
      persona: PLANEJADOR_PERSONA,
      negativas: PLANEJADOR_NEGATIVAS,
      poucosExemplos: PLANEJADOR_EXEMPLOS,
      ferramentas,
      contextoOperacional: `Data de hoje: ${new Date().toISOString().slice(0, 10)}.`,
      formatoResposta:
        'Português do Brasil, Markdown simples. Resposta direta primeiro, lista depois. ' +
        'Ao propor uma escrita, termine com uma pergunta de confirmação explícita.'
    })
  });
}
