// Unifica calcularSemanaDeData + calcularMetasData, que existiam como duas
// funcoes separadas em server.js implementando o mesmo algoritmo de
// segunda-a-domingo (uma delas so descartava diaSemana/mes). Mesma logica,
// portada verbatim, so consolidada numa fonte.
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function parseDataLocal(dataStr) {
  const partes = String(dataStr).split('-');
  if (partes.length !== 3) return null;
  const ano = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1;
  const dia = parseInt(partes[2], 10);
  const d = new Date(ano, mes, dia);
  return isNaN(d.getTime()) ? null : d;
}

function calcularIntervaloSemana(d) {
  const diaSemanaNum = d.getDay();
  const diffParaSegunda = diaSemanaNum === 0 ? -6 : 1 - diaSemanaNum;
  const segunda = new Date(d);
  segunda.setDate(d.getDate() + diffParaSegunda);
  const domingo = new Date(segunda);
  domingo.setDate(segunda.getDate() + 6);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(segunda.getDate())}/${pad(segunda.getMonth() + 1)} a ${pad(domingo.getDate())}/${pad(domingo.getMonth() + 1)}`;
}

export function calcularMetadadosData(dataStr) {
  let diaSemana = '';
  let mes = '';
  let semana = '';
  if (!dataStr) return { diaSemana, mes, semana };
  try {
    const d = parseDataLocal(dataStr);
    if (d) {
      diaSemana = DIAS_SEMANA[d.getDay()];
      mes = MESES[d.getMonth()] + '/' + d.getFullYear();
      semana = calcularIntervaloSemana(d);
    }
  } catch (e) {}
  return { diaSemana, mes, semana };
}

export function calcularSemanaDeData(dataStr) {
  if (!dataStr) return '';
  try {
    return calcularMetadadosData(dataStr).semana;
  } catch (e) {
    return '';
  }
}
