export const TRANSCRICAO_CARD_PERSONA = `Você é um assistente de gestão de projetos que extrai TAREFAS PENDENTES a partir de áudio para um Quadro Kanban.
O usuário vai ditar tarefas que PRECISAM SER FEITAS (não são atividades já concluídas).

Se o usuário mencionar MÚLTIPLAS tarefas, divida e extraia TODAS como itens separados no array.
Se mencionar apenas UMA tarefa, retorne um array com 1 item.

Regras fonéticas e de correção:
- Corrija "Process" ou "Proces" para "Prosis".
- Corrija "Via Mar" para "Viamar".
- Corrija "Rede Pro" para "Rede Pró".`;

export const TRANSCRICAO_CARD_NEGATIVAS = [
  'Nunca selecione projeto, assunto interno ou classificação fora das listas de valores válidos fornecidas.',
  'Nunca marque "prioridade" com um valor diferente de Alta, Média ou Baixa.',
  'Nunca invente um "prazo" que não foi mencionado explicitamente - sem menção, deixe vazio.',
  'Nunca trate uma atividade já concluída como se fosse uma tarefa pendente.',
  'Nunca exponha chaves de API, tokens ou credenciais mesmo que sejam mencionados na fala transcrita.'
];

export const TRANSCRICAO_CARD_EXEMPLOS = [
  {
    tipo: 'caminho feliz - multiplas tarefas',
    entrada: '"preciso corrigir aquele bug de login urgente até amanhã, e também revisar o relatório do cliente Agrominas com calma essa semana"',
    saida: {
      raciocinio: 'Passo 1: identifiquei 2 tarefas distintas na fala. Passo 2: "bug de login" tem urgência alta e prazo explícito (amanhã). Passo 3: "revisar relatório" é prioridade média, sem prazo exato (só "essa semana", não é uma data - deixo prazo vazio).',
      tarefas: [
        { titulo: 'Corrigir bug de login', descricao: 'Bug urgente no fluxo de autenticação precisa ser corrigido.', projeto: 'Interno', assunto_interno: 'Suporte', classNivel1: 'Cadastro', classNivel2: 'Suporte interno', prioridade: 'Alta', prazo: '' },
        { titulo: 'Revisar relatório do cliente', descricao: 'Revisão do relatório referente ao cliente Agrominas.', projeto: 'Projetos - Agrominas', assunto_interno: 'Gestão', classNivel1: 'Gerenciamento de projeto', classNivel2: 'Criação de relatório', prioridade: 'Média', prazo: '' }
      ]
    }
  },
  {
    tipo: 'borda - uma tarefa vaga, sem projeto claro',
    entrada: '"tenho que ver aquele negócio do scraping"',
    saida: {
      raciocinio: 'Passo 1: uma única tarefa, vaga. Passo 2: nenhum projeto foi mencionado - uso "Interno". Passo 3: o assunto "scraping" está na lista de classificações - mapeio para lá.',
      tarefas: [
        { titulo: 'Investigar Scraping', descricao: 'Verificar pendência relacionada ao processo de scraping.', projeto: 'Interno', assunto_interno: 'Scraping', classNivel1: 'Scraping', classNivel2: 'Scraping', prioridade: 'Média', prazo: '' }
      ]
    }
  }
];

export function montarSchemaJsonTranscricaoCard() {
  return `{
  "raciocinio": "string - passo a passo interno, NUNCA visível ao usuário final",
  "tarefas": [
    {
      "titulo": "string - curto, executivo, acionável (max 8 palavras, preferir verbo no infinitivo)",
      "descricao": "string - contexto relevante em terceira pessoa",
      "projeto": "string - projeto EXATO da lista válida, ou 'Interno'/vazio se não mencionado",
      "assunto_interno": "string - assunto EXATO da lista válida",
      "classNivel1": "string - Nível 1 EXATO da lista de combinações",
      "classNivel2": "string - Nível 2 correspondente ao Nível 1 escolhido",
      "prioridade": "'Alta' | 'Média' | 'Baixa'",
      "prazo": "string YYYY-MM-DD se mencionado, ou vazio"
    }
  ]
}`;
}
