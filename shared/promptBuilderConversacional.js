// Irmao conversacional de promptBuilder.js.
//
// Por que nao reusar o outro: `montarSystemPrompt` termina com "Formato de
// saida obrigatorio (JSON estrito, sem markdown, sem texto fora do JSON)" e
// pede o raciocinio dentro de um campo `raciocinio`. Isso e correto para os
// use-cases que devolvem estrutura para a UI (relatorio, transcricao), e
// errado para um agente que conversa e chama ferramentas: o modelo precisa
// emitir `tool_calls` e, no fim, texto em portugues para uma pessoa ler.
//
// Os blocos que fazem sentido nos dois (persona, negativas, few-shot) tem a
// mesma forma de la, de proposito - quem ja escreveu um *PromptConfig.js
// neste projeto escreve um destes sem aprender outro formato.
export function montarSystemPromptConversacional({
  persona,
  negativas = [],
  poucosExemplos = [],
  ferramentas = [],
  contextoOperacional = '',
  formatoResposta = ''
}) {
  const blocos = [persona.trim()];

  if (ferramentas.length) {
    blocos.push(
      'Ferramentas disponíveis (use-as; nunca responda de memória sobre dados do usuário):\n' +
      ferramentas.map(f => `- ${f.nome}: ${f.descricao}`).join('\n')
    );
  }

  if (contextoOperacional) {
    blocos.push(`Contexto da conversa:\n${contextoOperacional.trim()}`);
  }

  if (negativas.length) {
    blocos.push(
      'Restrições obrigatórias (NUNCA viole estas regras):\n' +
      negativas.map(n => `- ${n}`).join('\n')
    );
  }

  if (poucosExemplos.length) {
    blocos.push(
      // A primeira versao destes prompts trazia datas e numeros concretos nos
      // exemplos, e o modelo os COPIAVA para a resposta real (chegou a
      // delegar "a semana de 22/09 a 28/09" quando o usuario disse "essa
      // semana"). Exemplo com valor concreto vira dado. A convencao ‹...›
      // marca o encaixe e esta regra a explica uma vez, para todos os agentes.
      'Exemplos de referência (padrão de comportamento e formato, NUNCA o conteúdo):\n' +
      'Trechos entre ‹ › são espaços a preencher com o dado real vindo das ferramentas — jamais ' +
      'escreva os sinais ‹ › na sua resposta. Qualquer valor concreto que apareça nos exemplos ' +
      '(datas, horas, quantidades, nomes de projeto) é ilustrativo: nunca reaproveite nenhum deles.\n\n' +
      poucosExemplos.map((ex, i) => {
        const partes = [`Exemplo ${i + 1} (${ex.tipo}):`, `Usuário: ${ex.entrada}`];
        if (ex.ferramentas) partes.push(`Ferramentas que você deve chamar: ${ex.ferramentas.join(', ')}`);
        partes.push(`Resposta esperada:\n${ex.saida}`);
        return partes.join('\n');
      }).join('\n\n')
    );
  }

  if (formatoResposta) {
    blocos.push(`Formato da resposta final:\n${formatoResposta.trim()}`);
  }

  // Regra transversal do sistema, repetida em todo agente de proposito: e a
  // unica que, se violada, produz um erro que o usuario nao tem como
  // perceber - um numero inventado parece igual a um numero correto.
  blocos.push(
    'Regra inviolável sobre dados:\n' +
    '- Todo número, data, nome de projeto ou título de atividade que você citar precisa ter vindo ' +
    'do resultado de uma ferramenta nesta mesma conversa.\n' +
    '- Nunca some, estime ou arredonde tempos por conta própria: use os totais já calculados que a ' +
    'ferramenta devolve (campos "totais", "formatado", "humano").\n' +
    '- Se a ferramenta não trouxe a informação, diga que não tem o dado. Não preencha lacuna com suposição.'
  );

  return blocos.join('\n\n');
}
