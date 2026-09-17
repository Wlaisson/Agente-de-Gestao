export const TEMPO_PADRAO = '00:00:00';

export function gerarIdAtividade() {
  return `ATV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
