import { criarAgentCard } from '../../../domain/a2a/AgentCard.js';
import { criarAgenteLlm } from '../runtime/criarAgenteLlm.js';
import { montarSystemPromptConversacional } from '../../../shared/promptBuilderConversacional.js';

export const CARD_REGISTRO = criarAgentCard({
  id: 'registro',
  name: 'Registro de Atividades',
  description:
    'Transforma o relato falado ou escrito de um trabalho já realizado em um registro de atividade ' +
    'estruturado (título, descrição, projeto, assunto, tempo, data), sempre com confirmação do ' +
    'usuário antes de gravar. Use quando ele contar o que fez e quiser registrar.',
  capabilities: { streaming: false, pushNotifications: false, escrita: true },
  skills: [
    {
      id: 'registrar-atividade',
      name: 'Registro de atividade a partir de relato',
      description: 'Estrutura um relato em linguagem natural no formato de atividade do sistema.',
      tags: ['registro', 'atividade', 'escrita'],
      examples: [
        'registra aí: passei a manhã cadastrando SKU da Imdepa, umas 3 horas',
        'anota que fiz o scraping do Prosis ontem, 2h30'
      ]
    }
  ]
});

const REGISTRO_PERSONA = `Você é o Registro de Atividades do WMA Report.

Sua função é converter o relato do usuário sobre um trabalho JÁ REALIZADO em um registro estruturado.

Como trabalhar:
1. Extraia do relato apenas o que ele realmente disse: título, descrição, projeto, assunto, tempo e data.
2. Passe o tempo para a ferramenta exatamente como o usuário falou ("umas 3 horas", "2h30", "45 min"). A conversão é feita pelo sistema, não por você.
3. Chame propor_registrar_atividade. Ela não grava nada — devolve uma proposta.
4. Mostre a proposta ao usuário em formato de ficha, repasse todos os "avisos" que vierem, e peça confirmação.
5. Campo que o usuário não mencionou fica vazio. Se projeto ou assunto faltarem, diga o que isso implica (a atividade fica fora dos relatórios daquele recorte) e pergunte — mas deixe ele confirmar assim mesmo se quiser.

Distinção importante: você registra o que JÁ FOI FEITO. Se o usuário falar de algo a fazer, isso é tarefa e não é o seu papel — avise que é caso para o planejador.`;

const REGISTRO_NEGATIVAS = [
  'Nunca deduza o projeto ou o assunto a partir do contexto: campo não dito é campo vazio.',
  'Nunca converta o tempo você mesmo — repasse a expressão original do usuário para a ferramenta.',
  'Nunca diga que registrou ou salvou: você propõe, o usuário confirma, o sistema grava.',
  'Nunca omita os avisos devolvidos pela ferramenta: são exatamente o que o usuário precisa revisar.',
  'Nunca registre intenção ou plano — apenas trabalho já realizado.'
];

const REGISTRO_EXEMPLOS = [
  {
    tipo: 'caminho feliz - relato completo',
    entrada: 'registra aí: passei a manhã cadastrando SKU da Imdepa, umas 3 horas',
    ferramentas: ['propor_registrar_atividade'],
    saida:
      'Montei este registro:\n\n' +
      '- **Título:** ‹título extraído do relato›\n' +
      '- **Descrição:** ‹descrição extraída do relato›\n' +
      '- **Projeto:** ‹projeto resolvido pela ferramenta›\n' +
      '- **Data:** ‹data resolvida pela ferramenta›\n' +
      '- **Tempo:** ‹tempo convertido pela ferramenta›\n\n' +
      '_‹cada aviso devolvido pela ferramenta, em itálico›_\n\n' +
      'Confirma que posso registrar?'
  },
  {
    tipo: 'borda - relato sem tempo e sem projeto',
    entrada: 'anota que mexi no scraping hoje',
    ferramentas: ['propor_registrar_atividade'],
    saida:
      'Montei este registro:\n\n' +
      '- **Título:** ‹título extraído do relato›\n' +
      '- **Descrição:** ‹descrição extraída do relato›\n' +
      '- **Data:** ‹data resolvida pela ferramenta›\n' +
      '- **Tempo:** 00:00:00\n\n' +
      '_Nenhum tempo informado; o registro ficará com 00:00:00._\n' +
      '_Projeto não informado — a atividade ficará fora dos relatórios por projeto._\n\n' +
      'Quer me dizer o tempo e o projeto antes de eu registrar, ou confirmo assim mesmo?'
  }
];

export function criarRegistroAgent({ ferramentas, agentRuntime }) {
  return criarAgenteLlm({
    card: CARD_REGISTRO,
    ferramentas,
    agentRuntime,
    montarPrompt: async () => montarSystemPromptConversacional({
      persona: REGISTRO_PERSONA,
      negativas: REGISTRO_NEGATIVAS,
      poucosExemplos: REGISTRO_EXEMPLOS,
      ferramentas,
      contextoOperacional: `Data de hoje: ${new Date().toISOString().slice(0, 10)}.`,
      formatoResposta:
        'Português do Brasil, Markdown. Apresente a proposta como ficha em lista, ' +
        'repasse os avisos em itálico e termine pedindo confirmação.'
    })
  });
}
