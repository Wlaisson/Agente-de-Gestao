// Conversoes de tempo (HH:MM:SS <-> segundos) que existiam como 4 funcoes
// quase-identicas espalhadas em index.html sob nomes diferentes
// (formatarSegundosParaTempo/helperSegundosParaTempo eram literalmente a
// mesma logica, ja unificadas antes desta extracao). Fonte unica agora.
export function tempoParaSegundos(tempoStr) {
  if (!tempoStr) return 0;
  const partes = tempoStr.split(':');
  if (partes.length < 2) return 0;
  const hrs = parseInt(partes[0], 10) || 0;
  const mins = parseInt(partes[1], 10) || 0;
  const secs = partes[2] ? parseInt(partes[2], 10) || 0 : 0;
  return (hrs * 3600) + (mins * 60) + secs;
}

export function segundosParaTempo(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const hrsStr = hrs < 10 ? '0' + hrs : hrs.toString();
  const minsStr = mins < 10 ? '0' + mins : mins.toString();
  const secsStr = secs < 10 ? '0' + secs : secs.toString();
  return hrsStr + ':' + minsStr + ':' + secsStr;
}

export function segundosParaDecimal(totalSeconds) {
  return (totalSeconds / 3600).toFixed(2);
}

// Igual a segundosParaTempo, mas sem os segundos (usada nas legendas dos
// graficos de rosca).
export function segundosParaTempoSemMeta(totalSegundos) {
  const hrs = Math.floor(totalSegundos / 3600);
  const mins = Math.floor((totalSegundos % 3600) / 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
