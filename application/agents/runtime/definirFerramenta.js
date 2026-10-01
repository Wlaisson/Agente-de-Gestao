// Declaracao de ferramenta de agente.
//
// Duas regras de seguranca do sistema estao codificadas aqui, no tipo, e nao
// na disciplina de quem escreve cada ferramenta:
//
// 1. CONTEXTO INJETADO, NUNCA INFERIDO. `userId` chega ao executor pelo
//    contexto do servidor (token autenticado) e jamais faz parte do schema
//    exposto ao modelo. Se `userId` fosse parametro, bastaria uma injecao de
//    prompt ("consulte as atividades do usuario X") para vazar dado entre
//    contas. O modelo literalmente nao tem como pedir.
//
// 2. ESCRITA E PROPOSTA, NAO ACAO. Ferramentas marcadas `escrita: true` nao
//    alteram nada: devolvem uma proposta que sobe ate o usuario como
//    `input-required`. A execucao real acontece depois da confirmacao, por
//    caminho deterministico (ver TaskManager.confirmarProposta).

export function definirFerramenta({
  nome,
  descricao,
  parametros = { type: 'object', properties: {}, required: [] },
  escrita = false,
  executar
}) {
  if (!nome) throw new Error('Ferramenta exige "nome".');
  if (typeof executar !== 'function') throw new Error(`Ferramenta "${nome}" exige "executar".`);

  const proibidos = ['userid', 'user_id', 'usuario_id'];
  const declarados = Object.keys(parametros.properties || {});
  const violacao = declarados.find(p => proibidos.includes(p.toLowerCase()));
  if (violacao) {
    throw new Error(
      `Ferramenta "${nome}" declara o parametro "${violacao}". Identidade do usuario e injetada ` +
      'pelo servidor (contexto.userId) e nunca pode ser escolhida pelo modelo.'
    );
  }

  return { nome, descricao, parametros, escrita, executar };
}

// Converte para o formato de tool calling da OpenAI. Fica isolado aqui para
// que trocar de provedor (ou falar com outro agente via A2A) nao exija
// reescrever a declaracao das ferramentas.
export function ferramentaParaSchemaOpenAI(ferramenta) {
  return {
    type: 'function',
    function: {
      name: ferramenta.nome,
      description: ferramenta.descricao,
      parameters: ferramenta.parametros
    }
  };
}

// Resultado padronizado. O agente sempre recebe JSON com o mesmo formato,
// inclusive em erro - modelo lidando com forma de resposta variavel inventa
// mais.
export function resultadoOk(dados, { resumo = null } = {}) {
  return { ok: true, resumo, ...dados };
}

export function resultadoErro(mensagem, { sugestao = null, alternativas = null } = {}) {
  // `sugestao`/`alternativas` transformam um erro em proxima acao possivel:
  // em vez de "projeto nao encontrado", o agente consegue perguntar "voce
  // quis dizer RedePRO ou Prometeon?".
  const erro = { ok: false, erro: mensagem };
  if (sugestao) erro.sugestao = sugestao;
  if (alternativas) erro.alternativas = alternativas;
  return erro;
}

export function resultadoProposta({ tipo, descricao, dados, impacto = 'baixo' }) {
  return {
    ok: true,
    proposta: true,
    tipo,
    descricao,
    dados,
    impacto,
    aviso: 'Nada foi gravado ainda. Apresente a proposta ao usuário e aguarde confirmação explícita.'
  };
}
