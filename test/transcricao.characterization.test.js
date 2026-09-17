// Characterization tests para /api/transcrever e /api/transcrever-kanban
// (fase 7). Estas rotas dependem de multer (upload multipart) e da SDK da
// OpenAI - ambos mockados aqui. Escrito tambem para fechar uma lacuna real:
// a fase 4 apagou por engano `formatarListasParaPrompt` (usada por estas
// duas rotas) e nenhum teste existente cobria isso; corrigido na propria
// fase 7, e agora coberto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer } from './helpers/testServer.js';
import { calledWith } from './helpers/supabaseMock.js';

let ctx;
const kanbanFile = path.join(process.cwd(), 'kanban_data.json');

before(async () => {
  if (fs.existsSync(kanbanFile)) fs.unlinkSync(kanbanFile);
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
  if (fs.existsSync(kanbanFile)) fs.unlinkSync(kanbanFile);
});

const OPCOES_FIXTURE = {
  assuntosInternos: ['Prosis'],
  projetos: ['Interno'],
  classificacoes: { Cadastro: ['Scraping'] }
};

function opcoesTable() {
  return (table, calls) => {
    if (table !== 'opcoes_sistema') return { data: null, error: null };
    if (calledWith(calls, 'single')) return { data: { dados: OPCOES_FIXTURE }, error: null };
    return { data: null, error: null };
  };
}

function kanbanTableEmpty() {
  return (table, calls) => {
    if (table !== 'kanban_cards') return { data: null, error: null };
    if (calledWith(calls, 'select')) return { data: [], error: null };
    return { data: null, error: null };
  };
}

function montarFormData() {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('fake-audio-bytes')], { type: 'audio/webm' }), 'gravacao.webm');
  return form;
}

test('POST /api/transcrever sem arquivo -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/transcrever`, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
});

test('POST /api/transcrever: transcreve, monta prompt com as opcoes e retorna o JSON da IA', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable());
  ctx.openai.setTranscriptionHandler(async () => ({ text: 'trabalhei no prosis por uma hora' }));
  ctx.openai.setChatHandler(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          projeto_oficial: 'Interno',
          assunto_interno: 'Prosis',
          titulo: 'Manutenção no Prosis',
          descricao: 'Realizada manutenção no sistema Prosis.',
          tempo: '01:00:00',
          classNivel1: 'Cadastro',
          classNivel2: 'Scraping'
        })
      }
    }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/transcrever`, { method: 'POST', body: montarFormData() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.titulo, 'Manutenção no Prosis');
  assert.equal(body.assunto_interno, 'Prosis');
});

test('POST /api/transcrever: resposta da IA nao-JSON cai no fallback via regex', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable());
  ctx.openai.setTranscriptionHandler(async () => ({ text: 'algo' }));
  ctx.openai.setChatHandler(async () => ({
    choices: [{ message: { content: 'isso nao e json valido "titulo": "Recuperado via Regex"' } }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/transcrever`, { method: 'POST', body: montarFormData() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.titulo, 'Recuperado via Regex');
  assert.equal(body.projeto_oficial, 'Interno'); // default quando nao casado pela regex
});

test('POST /api/transcrever-kanban sem arquivo -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/transcrever-kanban`, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
});

test('POST /api/transcrever-kanban: audio sem fala detectada -> 400', async () => {
  ctx.openai.setTranscriptionHandler(async () => ({ text: '   ' }));
  const res = await fetch(`${ctx.baseUrl}/api/transcrever-kanban`, { method: 'POST', body: montarFormData() });
  assert.equal(res.status, 400);
});

test('POST /api/transcrever-kanban: cria um card por tarefa extraida', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable());
  ctx.supabase.setFromHandler(kanbanTableEmpty());
  ctx.openai.setTranscriptionHandler(async () => ({ text: 'preciso corrigir o bug X e revisar o relatorio Y' }));
  ctx.openai.setChatHandler(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          tarefas: [
            { titulo: 'Corrigir bug X', descricao: 'desc', projeto: 'Interno', assunto_interno: 'Prosis', classNivel1: 'Cadastro', classNivel2: 'Scraping', prioridade: 'Alta', prazo: '' },
            { titulo: 'Revisar relatório Y', descricao: 'desc2', projeto: 'Interno', assunto_interno: 'Prosis', classNivel1: 'Cadastro', classNivel2: 'Scraping', prioridade: 'Média', prazo: '' }
          ]
        })
      }
    }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/transcrever-kanban`, { method: 'POST', body: montarFormData() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tarefas.length, 2);
  assert.equal(body.tarefas[0].titulo, 'Corrigir bug X');
  assert.equal(body.tarefas[1].titulo, 'Revisar relatório Y');
});

test('POST /api/transcrever-kanban: falha da IA cai no placeholder de tarefa unica', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable());
  ctx.supabase.setFromHandler(kanbanTableEmpty());
  ctx.openai.setTranscriptionHandler(async () => ({ text: 'algo incompreensivel' }));
  ctx.openai.setChatHandler(async () => { throw new Error('falha simulada do modelo'); });

  const res = await fetch(`${ctx.baseUrl}/api/transcrever-kanban`, { method: 'POST', body: montarFormData() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tarefas.length, 1);
  assert.equal(body.tarefas[0].titulo, 'Nova Tarefa Registrada');
});
