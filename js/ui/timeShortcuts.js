import { tempoParaSegundos, segundosParaTempo } from '../domain/tempo.js';

// Logica dos botoes de atalho (+15/+30/+60/+120 min) - estava triplicada em
// index.html (adicionarMinutos/adicionarMinutosEdicao/adicionarMinutosConclusao),
// diferindo so pelo id do campo alvo.
export function adicionarMinutosAoCampo(inputId, minutos) {
  const input = document.getElementById(inputId);
  const valorAtual = input.value.trim();
  let totalSegundos = 0;
  if (valorAtual && valorAtual.match(/^\d{2}:\d{2}:\d{2}$/)) {
    totalSegundos = tempoParaSegundos(valorAtual);
  }
  totalSegundos += minutos * 60;
  input.value = segundosParaTempo(totalSegundos);
}
