// Forma minima que server.js sempre exigiu para aceitar um payload de opcoes
// (usado pela acao "salvar_tudo"). Portado verbatim.
export function isOpcoesValido(dados) {
  return Boolean(
    dados &&
    Array.isArray(dados.assuntosInternos) &&
    Array.isArray(dados.projetos) &&
    dados.classificacoes
  );
}

export const OPCOES_DEFAULT = {
  assuntosInternos: [
    "Prosis", "Viamar", "Infraestrutura", "Rede Pró", "Suporte", "Scraping",
    "Árvore de Categorias", "Automação", "Gestão", "Atendimento", "Integração API"
  ],
  projetos: [
    "Interno", "SMB - CBA Diesel", "Projetos - Rede Pró", "Projetos - Agrominas",
    "Projetos - Wurth", "Projetos - Campneus", "Projetos - Fortbras", "Projetos - CDC",
    "Projetos - Prometeon", "Projetos - Tracbel", "Fabricantes - Unimil", "Fabricantes - Círculo",
    "Projetos - Rodobens", "Projetos - Leo Madeira", "Fabricantes - Intercoffee",
    "Projetos - Bunge", "SMB - Rasec", "Projetos - Broto"
  ],
  classificacoes: {
    "Cadastro": [
      "Avaliação de dados recebidos", "Contato com fabricantes", "Contato com lojista",
      "Scraping", "Tratamento de SKU", "Tratamento de imagem", "Tratamento de aplicações",
      "Reunião com cliente", "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Gerenciamento de projeto": [
      "Criação de relatório", "Reunião com cliente", "Reunião sobre projeto", "Suporte ao cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Infraestrutura": [
      "Categorias", "Base de veículos", "Cadastro de fabricantes", "Reunião com cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Matching": [
      "Cadastro de sinônimos de nome de fabricante ou código de peça", "Reunião com cliente",
      "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Qualidade": [
      "Personalização de cadastro", "Correção de cadastro errado (Recebemos a informação correta e erramos na manipulação)",
      "Reunião com cliente", "Reunião sobre Atividade / Projeto", "Consultoria", "Suporte interno"
    ],
    "Orçamento": ["Orçamento"],
    "Reunião que não é sobre a atividade [Projeto deve ser interno]": ["Reunião interna"],
    "Gestão de pessoas": [
      "Contratação / Feedback / Estratégia do dpto e etc", "Grestão de equipe, tarefas e demandas"
    ],
    "Scraping": ["Scraping"],
    "Sugestão e/ou Curadoria de Mídias CdP": ["Sugestão e/ou Curadoria de Mídias CdP"],
    "Automação": ["Scraping", "Tratamento de Vista Explodida"]
  }
};
