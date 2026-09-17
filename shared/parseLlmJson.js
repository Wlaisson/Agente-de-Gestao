// O "ladder" de resiliencia para respostas de IA que deveriam ser JSON mas
// vinham com <think>...</think>, cercas de markdown, ou texto extra ao redor
// do objeto - estava copiado quase verbatim em 5 rotas de server.js. Aqui os
// 3 primeiros passos (comuns aos 5 lugares): remover <think>, remover cercas
// ```json, tentar JSON.parse (com fallback para o trecho entre a primeira e
// a ultima chave). O 4o passo (o que fazer se AINDA falhar) difere por rota
// (extracao via regex, um placeholder fixo, ou ecoar os dados originais) -
// isso continua em cada use-case, usando `textoLimpo` devolvido aqui.
export function limparRespostaLlm(rawText) {
  let texto = (rawText || '').trim();
  texto = texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (texto.startsWith('```json')) {
    texto = texto.replace(/^```json/i, '').replace(/```$/i, '').trim();
  } else if (texto.startsWith('```')) {
    texto = texto.replace(/^```/i, '').replace(/```$/i, '').trim();
  }
  return texto;
}

export function parseLlmJson(rawText) {
  const textoLimpo = limparRespostaLlm(rawText);
  let resultado = null;
  try {
    resultado = JSON.parse(textoLimpo);
  } catch (e) {
    const firstBrace = textoLimpo.indexOf('{');
    const lastBrace = textoLimpo.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        resultado = JSON.parse(textoLimpo.substring(firstBrace, lastBrace + 1));
      } catch (innerErr) {
        resultado = null;
      }
    }
  }
  return { resultado, textoLimpo };
}
