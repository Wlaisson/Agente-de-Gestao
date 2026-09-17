// Formata projetos/assuntos/classificacoes em blocos de texto para embutir
// nos prompts de transcricao. Portado verbatim - era apagado por engano na
// fase 4 (vivia entre salvarOpcoes e as rotas de /api/opcoes no server.js
// original; o corte daquela fase levou essa funcao junto sem perceber que
// /api/transcrever e /api/transcrever-kanban tambem dependiam dela).
// Corrigido aqui, na fase que realmente migra essas duas rotas.
export function formatarListasParaPrompt(opcoes) {
  const listaProjetos = (opcoes.projetos || []).map(p => `- ${p}`).join('\n');
  const listaAssuntos = (opcoes.assuntosInternos || []).map(a => `- ${a}`).join('\n');
  const combinacoes = [];
  const classMap = opcoes.classificacoes || {};
  for (const c1 of Object.keys(classMap)) {
    const subs = classMap[c1];
    if (Array.isArray(subs) && subs.length > 0) {
      subs.forEach(c2 => combinacoes.push(`- ${c1} / ${c2}`));
    } else {
      combinacoes.push(`- ${c1}`);
    }
  }
  return {
    projetosStr: listaProjetos,
    assuntosStr: listaAssuntos,
    classificacoesStr: combinacoes.join('\n')
  };
}
