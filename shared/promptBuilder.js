// Monta o system prompt final a partir de blocos configuraveis - o "tratar
// prompt como codigo" pedido pelo usuario. Cada use-case de IA passa seu
// proprio persona/negativas/exemplos/schema (arquivos *PromptConfig.js
// colocados ao lado de cada use-case) em vez de concatenar strings a mao de
// um jeito diferente em cada lugar.
//
// Ordem dos blocos: [persona] + [negative prompting] + [few-shot] +
// [instrucao de CoT oculto] + [contexto RAG] + [schema JSON obrigatorio].
// O input do usuario continua sendo uma mensagem `{role:'user', ...}`
// separada, montada por cada use-case como sempre foi - este builder so
// produz o system prompt.
export function montarSystemPrompt({
  persona,
  negativas = [],
  poucosExemplos = [],
  schemaJson,
  contextoRag = '',
  raciocinioOculto = true
}) {
  const blocos = [persona.trim()];

  if (negativas.length) {
    blocos.push(
      'Restrições obrigatórias (NUNCA viole estas regras):\n' +
      negativas.map(n => `- ${n}`).join('\n')
    );
  }

  if (poucosExemplos.length) {
    blocos.push(
      'Exemplos de referência (padrão de raciocínio e formato, não o conteúdo literal):\n' +
      poucosExemplos.map((ex, i) =>
        `Exemplo ${i + 1} (${ex.tipo}):\nEntrada: ${ex.entrada}\nSaída esperada:\n${JSON.stringify(ex.saida, null, 2)}`
      ).join('\n\n')
    );
  }

  if (raciocinioOculto) {
    blocos.push(
      'Raciocínio interno (NUNCA exposto ao usuário final):\n' +
      'Pense passo a passo (Passo 1, Passo 2, Passo 3...) antes de decidir a ' +
      'resposta final, e registre esse raciocínio apenas no campo "raciocinio" ' +
      'do JSON de saída. Esse campo é removido pelo backend antes de qualquer ' +
      'resposta chegar ao usuário - pode ser tão detalhado quanto necessário.'
    );
  }

  if (contextoRag) {
    blocos.push(
      `Dados recuperados do banco (contexto de referência - use para calibrar a resposta, não copie literalmente):\n${contextoRag}`
    );
  }

  blocos.push(
    `Formato de saída obrigatório (JSON estrito, sem markdown, sem texto fora do JSON):\n${schemaJson.trim()}`
  );

  return blocos.join('\n\n');
}
