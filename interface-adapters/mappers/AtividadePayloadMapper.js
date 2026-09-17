// Normalizacao multi-nome-de-campo (camelCase, snake_case e rotulos em
// portugues no estilo planilha) portada verbatim de POST/PUT /api/atividades
// em server.js. O cliente historico (era uma planilha) manda formas
// diferentes do mesmo campo; isso preserva compatibilidade com esse formato.
import { TEMPO_PADRAO, gerarIdAtividade } from '../../domain/entities/Atividade.js';
import { calcularSemanaDeData } from '../../domain/services/WeekCalculator.js';

// POST: sempre resolve um valor (com defaults), gera id se ausente.
export function mapearPayloadCriacao(b, userId) {
  const dataFinal = b.data || b.Data || new Date().toISOString().split('T')[0];
  let semanaFinal = b.semana || b['Texto Semana'] || b.textoSemana || '';
  if (!semanaFinal || semanaFinal.trim() === '') {
    semanaFinal = calcularSemanaDeData(dataFinal);
  }

  const projetoFinal = b.projeto || b.Projeto || '';
  const assuntoFinal = b.assuntoInterno || b.assunto_interno || b['Assunto Interno'] || '';
  const tituloFinal = b.titulo || b['Título'] || b.Titulo || '';
  const atividadeFinal = b.atividade || b.descricao || b['Atividade [Deixar claro no texto]'] || b.Atividade || '';
  const tempoFinal = b.tempo || b['Tempo (HH:MM:SS)'] || b.Tempo || TEMPO_PADRAO;
  const c1Final = b.classNivel1 || b.class_nivel_1 || b['Classificação nivel 1'] || b['Classificacao nivel 1'] || b['Classificação Nível 1'] || '';
  const c2Final = b.classNivel2 || b.class_nivel_2 || b['Classificação nivel 2'] || b['Classificacao nivel 2'] || b['Classificação Nível 2'] || '';

  const novoId = b.id || gerarIdAtividade();

  return {
    id: novoId,
    user_id: userId,
    data: dataFinal,
    semana: semanaFinal,
    projeto: projetoFinal,
    assunto_interno: assuntoFinal,
    titulo: tituloFinal,
    atividade: atividadeFinal,
    tempo: tempoFinal,
    class_nivel_1: c1Final,
    class_nivel_2: c2Final,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// PUT: so inclui campos explicitamente presentes no body (update parcial de verdade).
export function mapearPayloadAtualizacao(b) {
  const dados = { updated_at: new Date().toISOString() };

  const dataVal = b.data !== undefined ? b.data : b.Data;
  if (dataVal !== undefined) dados.data = dataVal;

  const semanaVal = b.semana !== undefined ? b.semana : (b['Texto Semana'] !== undefined ? b['Texto Semana'] : b.textoSemana);
  if (semanaVal !== undefined) dados.semana = semanaVal;

  const projVal = b.projeto !== undefined ? b.projeto : b.Projeto;
  if (projVal !== undefined) dados.projeto = projVal;

  const assuntoVal = b.assuntoInterno !== undefined ? b.assuntoInterno : (b.assunto_interno !== undefined ? b.assunto_interno : b['Assunto Interno']);
  if (assuntoVal !== undefined) dados.assunto_interno = assuntoVal;

  const tituloVal = b.titulo !== undefined ? b.titulo : (b['Título'] !== undefined ? b['Título'] : b.Titulo);
  if (tituloVal !== undefined) dados.titulo = tituloVal;

  const ativVal = b.atividade !== undefined ? b.atividade : (b.descricao !== undefined ? b.descricao : (b['Atividade [Deixar claro no texto]'] !== undefined ? b['Atividade [Deixar claro no texto]'] : b.Atividade));
  if (ativVal !== undefined) dados.atividade = ativVal;

  const tempoVal = b.tempo !== undefined ? b.tempo : (b['Tempo (HH:MM:SS)'] !== undefined ? b['Tempo (HH:MM:SS)'] : b.Tempo);
  if (tempoVal !== undefined) dados.tempo = tempoVal;

  const c1Val = b.classNivel1 !== undefined ? b.classNivel1 : (b.class_nivel_1 !== undefined ? b.class_nivel_1 : (b['Classificação nivel 1'] !== undefined ? b['Classificação nivel 1'] : b['Classificação Nível 1']));
  if (c1Val !== undefined) dados.class_nivel_1 = c1Val;

  const c2Val = b.classNivel2 !== undefined ? b.classNivel2 : (b.class_nivel_2 !== undefined ? b.class_nivel_2 : (b['Classificação nivel 2'] !== undefined ? b['Classificação nivel 2'] : b['Classificação Nível 2']));
  if (c2Val !== undefined) dados.class_nivel_2 = c2Val;

  if ((!dados.semana || dados.semana.trim() === '') && dados.data) {
    dados.semana = calcularSemanaDeData(dados.data);
  }

  return dados;
}

// GET: DB (snake_case) -> forma da API (camelCase), com diaSemana/mes/semana calculados.
export function mapearLinhaParaResposta(item, calcularMetadadosData) {
  const meta = calcularMetadadosData(item.data);
  const semanaFinal = (item.semana && item.semana.trim() !== '') ? item.semana : meta.semana;
  return {
    id: item.id,
    row: item.id,
    data: item.data,
    diaSemana: meta.diaSemana,
    mes: meta.mes,
    semana: semanaFinal,
    projeto: item.projeto || '',
    assuntoInterno: item.assunto_interno || '',
    titulo: item.titulo || '',
    atividade: item.atividade || '',
    tempo: item.tempo || TEMPO_PADRAO,
    classNivel1: item.class_nivel_1 || '',
    classNivel2: item.class_nivel_2 || '',
    userId: item.user_id
  };
}
