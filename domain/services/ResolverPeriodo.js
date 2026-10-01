// Traduz periodo falado ("essa semana", "mes passado", "ultimos 30 dias")
// para o intervalo de datas que o repositorio entende.
//
// Fica no dominio, e nao no prompt, por uma razao de confiabilidade: se o
// modelo calculasse as datas, "semana passada" viraria um intervalo
// ligeiramente diferente a cada chamada, e os numeros do relatorio deixariam
// de ser reproduziveis. Aqui a conta e deterministica e testavel.
//
// A semana e segunda-a-domingo, igual ao WeekCalculator - as atividades ja
// sao gravadas com o rotulo "DD/MM a DD/MM" gerado por ele, entao qualquer
// outra convencao aqui criaria dois conceitos de "semana" no mesmo produto.

import { calcularSemanaDeData } from './WeekCalculator.js';

const MESES = {
  janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
};

function pad(n) {
  return String(n).padStart(2, '0');
}

export function paraIsoData(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function segundaDaSemana(d) {
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(d);
  segunda.setDate(d.getDate() + diff);
  segunda.setHours(0, 0, 0, 0);
  return segunda;
}

function intervalo(inicio, fim, descricao, extras = {}) {
  return {
    start: paraIsoData(inicio),
    end: paraIsoData(fim),
    descricao,
    ...extras
  };
}

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// `hoje` e injetavel para os testes nao dependerem da data real da maquina.
export function resolverPeriodo(expressao, { hoje = new Date() } = {}) {
  const texto = normalizar(expressao);
  const base = new Date(hoje);
  base.setHours(0, 0, 0, 0);

  // Sem expressao, o padrao e a semana corrente: e o recorte que o produto
  // inteiro usa (Resumo Executivo Semanal, Agente Reporter, Weekly).
  if (!texto || texto === 'essa semana' || texto === 'esta semana' || texto === 'semana atual' || texto === 'semana') {
    const segunda = segundaDaSemana(base);
    const domingo = new Date(segunda);
    domingo.setDate(segunda.getDate() + 6);
    return intervalo(segunda, domingo, 'esta semana', { semana: calcularSemanaDeData(paraIsoData(segunda)) });
  }

  if (/semana passada|semana anterior|ultima semana/.test(texto)) {
    const segunda = segundaDaSemana(base);
    segunda.setDate(segunda.getDate() - 7);
    const domingo = new Date(segunda);
    domingo.setDate(segunda.getDate() + 6);
    return intervalo(segunda, domingo, 'semana passada', { semana: calcularSemanaDeData(paraIsoData(segunda)) });
  }

  if (texto === 'hoje') {
    return intervalo(base, base, 'hoje');
  }

  if (texto === 'ontem') {
    const ontem = new Date(base);
    ontem.setDate(base.getDate() - 1);
    return intervalo(ontem, ontem, 'ontem');
  }

  if (/este mes|esse mes|mes atual/.test(texto)) {
    const inicio = new Date(base.getFullYear(), base.getMonth(), 1);
    const fim = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return intervalo(inicio, fim, 'este mês');
  }

  if (/mes passado|mes anterior|ultimo mes/.test(texto)) {
    const inicio = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const fim = new Date(base.getFullYear(), base.getMonth(), 0);
    return intervalo(inicio, fim, 'mês passado');
  }

  // "ultimos 30 dias" / "ultimas 2 semanas"
  const relativo = texto.match(/ultim[oa]s?\s+(\d+)\s+(dias?|semanas?|meses|mes)/);
  if (relativo) {
    const n = parseInt(relativo[1], 10);
    const unidade = relativo[2];
    const inicio = new Date(base);
    if (/^dia/.test(unidade)) inicio.setDate(base.getDate() - n + 1);
    else if (/^semana/.test(unidade)) inicio.setDate(base.getDate() - (n * 7) + 1);
    else inicio.setMonth(base.getMonth() - n);
    return intervalo(inicio, base, `últimos ${n} ${unidade}`);
  }

  // Mes nomeado, com ano opcional ("setembro", "setembro de 2026").
  for (const [nome, indice] of Object.entries(MESES)) {
    if (texto.includes(nome)) {
      const anoMatch = texto.match(/\b(20\d{2})\b/);
      const ano = anoMatch ? parseInt(anoMatch[1], 10) : base.getFullYear();
      const inicio = new Date(ano, indice, 1);
      const fim = new Date(ano, indice + 1, 0);
      return intervalo(inicio, fim, `${nome}/${ano}`);
    }
  }

  // Intervalo explicito "2026-09-01 a 2026-09-30" / "01/09 a 30/09".
  const iso = texto.match(/(\d{4}-\d{2}-\d{2})\s*(?:a|ate|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    return { start: iso[1], end: iso[2], descricao: `${iso[1]} a ${iso[2]}` };
  }

  // Rotulo de semana no formato ja gravado nas atividades ("22/09 a 28/09").
  const rotuloSemana = String(expressao ?? '').match(/^\s*(\d{2}\/\d{2})\s+a\s+(\d{2}\/\d{2})\s*$/);
  if (rotuloSemana) {
    return { start: null, end: null, semana: String(expressao).trim(), descricao: `semana ${String(expressao).trim()}` };
  }

  // Nao reconhecido: cair na semana atual em silencio esconderia o erro do
  // usuario. Sinalizamos para o agente poder perguntar.
  return {
    start: null,
    end: null,
    descricao: String(expressao ?? ''),
    naoReconhecido: true
  };
}
