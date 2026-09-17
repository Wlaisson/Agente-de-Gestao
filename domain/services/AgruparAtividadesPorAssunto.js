// Agrupamento por assunto interno, usado pelas duas rotas de relatorio (que
// compartilhavam ~70% de logica identica de busca+agrupamento no server.js
// original).
export function agruparPorAssunto(atividades) {
  const agrupado = {};
  for (const atv of atividades) {
    const chave = atv.assuntoInterno || 'Sem Assunto';
    if (!agrupado[chave]) {
      agrupado[chave] = [];
    }
    agrupado[chave].push(atv);
  }
  return agrupado;
}
