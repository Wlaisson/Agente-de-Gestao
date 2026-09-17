import { gerarIdCard } from '../../domain/entities/KanbanCard.js';

// Normalizacao multi-nome-de-campo portada verbatim das acoes add_kanban/
// edit_kanban de POST /api/kanban em server.js.
export function mapearNovoCard(body) {
  return {
    id: body.id || gerarIdCard(),
    titulo: body.titulo || '',
    descricao: body.descricao || '',
    projeto: body.projeto || '',
    assuntoInterno: body.assunto_interno || body.assuntoInterno || '',
    classNivel1: body.classNivel1 || body.class1 || '',
    classNivel2: body.classNivel2 || body.class2 || '',
    prioridade: body.prioridade || 'Média',
    status: body.status || 'A Fazer',
    dataCriacao: new Date().toISOString().split('T')[0],
    prazo: body.prazo || '',
    tempo: body.tempo || ''
  };
}

export function cardParaLinhaSupabase(card) {
  return {
    id: card.id,
    titulo: card.titulo,
    descricao: card.descricao,
    projeto: card.projeto,
    assunto_interno: card.assuntoInterno,
    class_nivel_1: card.classNivel1,
    class_nivel_2: card.classNivel2,
    prioridade: card.prioridade,
    status: card.status,
    data_criacao: card.dataCriacao,
    prazo: card.prazo,
    tempo: card.tempo,
    updated_at: new Date().toISOString()
  };
}

// edit_kanban/update_kanban: so aplica os campos presentes no body, tanto na
// forma "card" (camelCase, usada no cache local) quanto na forma da linha do
// Supabase (snake_case) - portado verbatim (inclusive as duas versoes
// calculadas em paralelo, como no server.js original).
export function mapearEdicaoCard(body) {
  const { titulo, descricao, projeto, assunto_interno, assuntoInterno, classNivel1, class1, classNivel2, class2, prioridade, prazo, status } = body;

  const camposCard = {};
  if (titulo !== undefined) camposCard.titulo = titulo;
  if (descricao !== undefined) camposCard.descricao = descricao;
  if (projeto !== undefined) camposCard.projeto = projeto;
  if (assunto_interno !== undefined || assuntoInterno !== undefined) {
    camposCard.assuntoInterno = assunto_interno || assuntoInterno || '';
  }
  if (classNivel1 !== undefined || class1 !== undefined) {
    camposCard.classNivel1 = classNivel1 || class1 || '';
  }
  if (classNivel2 !== undefined || class2 !== undefined) {
    camposCard.classNivel2 = classNivel2 || class2 || '';
  }
  if (prioridade !== undefined) camposCard.prioridade = prioridade;
  if (prazo !== undefined) camposCard.prazo = prazo;
  if (status !== undefined) camposCard.status = status;

  const camposSupabase = { updated_at: new Date().toISOString() };
  if (titulo !== undefined) camposSupabase.titulo = titulo;
  if (descricao !== undefined) camposSupabase.descricao = descricao;
  if (projeto !== undefined) camposSupabase.projeto = projeto;
  if (assunto_interno !== undefined || assuntoInterno !== undefined) {
    camposSupabase.assunto_interno = assunto_interno || assuntoInterno || '';
  }
  if (classNivel1 !== undefined || class1 !== undefined) {
    camposSupabase.class_nivel_1 = classNivel1 || class1 || '';
  }
  if (classNivel2 !== undefined || class2 !== undefined) {
    camposSupabase.class_nivel_2 = classNivel2 || class2 || '';
  }
  if (prioridade !== undefined) camposSupabase.prioridade = prioridade;
  if (prazo !== undefined) camposSupabase.prazo = prazo;
  if (status !== undefined) camposSupabase.status = status;

  const webhookPayload = {
    action: 'edit_kanban',
    titulo,
    descricao,
    projeto,
    assunto_interno: assunto_interno || assuntoInterno || '',
    classNivel1: classNivel1 || class1 || '',
    classNivel2: classNivel2 || class2 || '',
    prioridade,
    prazo,
    status
  };

  return { camposCard, camposSupabase, webhookPayload };
}
