// Estado hoje espalhado como globais soltos no script de index.html
// (todasAtividades, kanbanCards, campanhasDados, OPCOES_SISTEMA,
// MAPA_CLASSIFICACOES, configUsuarioAtual), centralizado num unico objeto
// mutavel. E um objeto (nao bindings `export let`) de proposito: o codigo
// original tanto MUTA quanto REATRIBUI essas variaveis em dezenas de lugares
// (ex.: `OPCOES_SISTEMA = json.data`), e bindings de import ES module sao
// somente-leitura no modulo que importa - reatribuir um `import { x }`
// quebraria com SyntaxError. Uma propriedade de objeto (`state.OPCOES_SISTEMA
// = json.data`) permite exatamente o mesmo padrao de uso de antes, so
// qualificado pelo namespace `state.`.
export const state = {
  todasAtividades: [],
  kanbanCards: [],
  campanhasDados: [],
  configUsuarioAtual: null,

  OPCOES_SISTEMA: {
    assuntosInternos: [],
    projetos: [],
    classificacoes: {}
  },

  // Valor padrao/seed mostrado antes de carregarOpcoesSistema() popular os
  // dados reais - portado verbatim do script original.
  MAPA_CLASSIFICACOES: {
    "Cadastro": [
      "Avaliação de dados recebidos",
      "Contato com fabricantes",
      "Contato com lojista",
      "Scraping",
      "Tratamento de SKU",
      "Tratamento de imagem",
      "Tratamento de aplicações",
      "Reunião com cliente",
      "Reunião sobre Atividade / Projeto",
      "Consultoria",
      "Suporte interno"
    ],
    "Gerenciamento de projeto": [
      "Criação de relatório",
      "Reunião com cliente",
      "Reunião sobre projeto",
      "Suporte ao cliente",
      "Reunião sobre Atividade / Projeto",
      "Consultoria",
      "Suporte interno"
    ],
    "Infraestrutura": [
      "Categorias",
      "Base de veículos",
      "Cadastro de fabricantes",
      "Reunião com cliente",
      "Reunião sobre Atividade / Projeto",
      "Consultoria",
      "Suporte interno"
    ],
    "Matching": [
      "Cadastro de sinônimos de nome de fabricante ou código de peça",
      "Reunião com cliente",
      "Reunião sobre Atividade / Projeto",
      "Consultoria",
      "Suporte interno"
    ],
    "Qualidade": [
      "Personalização de cadastro",
      "Correção de cadastro errado (Recebemos a informação correta e erramos na manipulação)",
      "Reunião com cliente",
      "Reunião sobre Atividade / Projeto",
      "Consultoria",
      "Suporte interno"
    ],
    "Orçamento": [
      "Orçamento"
    ],
    "Reunião que não é sobre a atividade [Projeto deve ser interno]": [
      "Reunião interna"
    ],
    "Gestão de pessoas": [
      "Contratação / Feedback / Estratégia do dpto e etc",
      "Grestão de equipe, tarefas e demandas"
    ],
    "Scraping": [
      "Scraping"
    ],
    "Sugestão e/ou Curadoria de Mídias CdP": [
      "Sugestão e/ou Curadoria de Mídias CdP"
    ],
    "Automação": [
      "Scraping",
      "Tratamento de Vista Explodida"
    ]
  }
};
