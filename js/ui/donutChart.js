// Matematica compartilhada pelos dois graficos de rosca (home dashboard e
// aba "Atividades da Semana"), que duplicavam ~20 linhas identicas de
// calculo de percentual/cor e construcao dos <circle> do SVG. Cada chamador
// continua responsavel pelo proprio alvo no DOM, dimensoes, paleta, texto de
// estado vazio e template da legenda - essas partes diferem de verdade entre
// os dois graficos (tamanhos, cores iniciais, limite de itens na legenda) e
// nao foram unificadas para nao mudar a aparencia atual de nenhum dos dois.
export function calcularSegmentosDonut(projetosDados, totalSegundos, cores) {
  let indexCor = 0;
  const projsArray = [];
  for (const proj in projetosDados) {
    const segundos = projetosDados[proj];
    const pct = (segundos / totalSegundos) * 100;
    projsArray.push({
      nome: proj,
      segundos: segundos,
      porcentagem: pct,
      cor: cores[indexCor % cores.length]
    });
    indexCor++;
  }
  projsArray.sort((a, b) => b.segundos - a.segundos);
  return projsArray;
}

export function construirCirculosSvg(projsArray, raio, transitionDuration) {
  const C = 2 * Math.PI * raio;
  let acumulado = 0;
  let circlesHTML = '';
  projsArray.forEach(p => {
    const dashArray = `${(p.porcentagem / 100) * C} ${C}`;
    const dashOffset = -((acumulado / 100) * C);
    circlesHTML += `
                    <circle cx="60" cy="60" r="${raio}" fill="none" stroke="${p.cor}" stroke-width="12"
                            stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}"
                            transform="rotate(-90 60 60)" style="transition: all ${transitionDuration} ease;" />
                `;
    acumulado += p.porcentagem;
  });
  return circlesHTML;
}
