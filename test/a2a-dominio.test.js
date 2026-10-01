// Testes do dominio do sistema multiagente.
//
// Concentram-se nas invariantes que, se quebrarem, produzem um erro que o
// usuario NAO consegue perceber: um total errado parece igual a um total
// certo, e uma confirmacao mal interpretada grava sem que ninguem tenha
// aprovado. Sao puros - sem rede, sem banco, sem modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ESTADOS_TAREFA,
  criarTarefa,
  transicionar,
  podeTransicionar,
  ehEstadoTerminal
} from '../domain/a2a/Task.js';
import { criarAgentCard } from '../domain/a2a/AgentCard.js';
import { mensagemAgente, extrairTexto, extrairDados } from '../domain/a2a/Message.js';
import {
  interpretarConfirmacao,
  RESULTADO_CONFIRMACAO
} from '../domain/services/InterpretarConfirmacao.js';
import {
  tempoParaSegundos,
  segundosParaTempo,
  segundosParaTextoHumano,
  somarTempoAtividades
} from '../domain/services/TempoCalculator.js';
import { resolverEntidade } from '../domain/services/ResolverEntidade.js';
import { resolverPeriodo } from '../domain/services/ResolverPeriodo.js';
import { definirFerramenta } from '../application/agents/runtime/definirFerramenta.js';

// ---------------------------------------------------------------------------
// Ciclo de vida da tarefa
// ---------------------------------------------------------------------------

test('Task: nova tarefa nasce em "submitted"', () => {
  const t = criarTarefa({ agentId: 'analista', userId: 'u1' });
  assert.equal(t.status.state, ESTADOS_TAREFA.SUBMETIDA);
  assert.equal(t.userId, 'u1');
  assert.ok(t.contextId);
});

test('Task: transicoes validas e invalidas seguem a maquina de estados', () => {
  assert.ok(podeTransicionar(ESTADOS_TAREFA.SUBMETIDA, ESTADOS_TAREFA.TRABALHANDO));
  assert.ok(podeTransicionar(ESTADOS_TAREFA.TRABALHANDO, ESTADOS_TAREFA.AGUARDANDO_ENTRADA));
  assert.ok(podeTransicionar(ESTADOS_TAREFA.AGUARDANDO_ENTRADA, ESTADOS_TAREFA.TRABALHANDO));

  // Pular de "aguardando confirmacao" direto para "concluida" burlaria a
  // rodada de execucao que aplica a proposta.
  assert.equal(podeTransicionar(ESTADOS_TAREFA.AGUARDANDO_ENTRADA, ESTADOS_TAREFA.CONCLUIDA), false);
  // Submetida nao pode concluir sem passar por trabalhando.
  assert.equal(podeTransicionar(ESTADOS_TAREFA.SUBMETIDA, ESTADOS_TAREFA.CONCLUIDA), false);
});

test('Task: estado terminal nao transiciona', () => {
  let t = criarTarefa({ agentId: 'a', userId: 'u1' });
  t = transicionar(t, ESTADOS_TAREFA.TRABALHANDO);
  t = transicionar(t, ESTADOS_TAREFA.CONCLUIDA);

  assert.ok(ehEstadoTerminal(t.status.state));
  assert.throws(() => transicionar(t, ESTADOS_TAREFA.TRABALHANDO), /Transicao invalida/);
});

test('Task: transicao e imutavel (nao muta a tarefa original)', () => {
  const original = criarTarefa({ agentId: 'a', userId: 'u1' });
  const nova = transicionar(original, ESTADOS_TAREFA.TRABALHANDO);
  assert.equal(original.status.state, ESTADOS_TAREFA.SUBMETIDA);
  assert.equal(nova.status.state, ESTADOS_TAREFA.TRABALHANDO);
});

// ---------------------------------------------------------------------------
// Portao de escrita: interpretacao de confirmacao
// ---------------------------------------------------------------------------

test('Confirmacao: DataPart estruturada e o caminho inequivoco', () => {
  assert.equal(
    interpretarConfirmacao({ dados: { confirmar: true } }).resultado,
    RESULTADO_CONFIRMACAO.CONFIRMADO
  );
  assert.equal(
    interpretarConfirmacao({ dados: { confirmar: false } }).resultado,
    RESULTADO_CONFIRMACAO.NEGADO
  );
});

test('Confirmacao: afirmacoes curtas confirmam', () => {
  for (const texto of ['sim', 'Sim!', 'ok', 'confirmo', 'pode criar', 'isso mesmo', 'manda ver']) {
    assert.equal(
      interpretarConfirmacao({ texto }).resultado,
      RESULTADO_CONFIRMACAO.CONFIRMADO,
      `"${texto}" deveria confirmar`
    );
  }
});

test('Confirmacao: negacoes negam, inclusive com acento e maiuscula', () => {
  for (const texto of ['não', 'nao', 'NÃO', 'cancela', 'espera', 'melhor não']) {
    assert.equal(
      interpretarConfirmacao({ texto }).resultado,
      RESULTADO_CONFIRMACAO.NEGADO,
      `"${texto}" deveria negar`
    );
  }
});

test('Confirmacao: "sim, mas..." NAO confirma - e instrucao nova, nao aceite', () => {
  // A regressao que este teste protege: tratar isso como "sim" gravaria a
  // proposta ANTIGA, ignorando a correcao que o usuario acabou de pedir.
  const r = interpretarConfirmacao({ texto: 'sim, mas antes troca o projeto para RedePRO' });
  assert.equal(r.resultado, RESULTADO_CONFIRMACAO.AMBIGUO);
});

test('Confirmacao: negacao vence afirmacao no mesmo texto', () => {
  const r = interpretarConfirmacao({ texto: 'ok nao' });
  assert.equal(r.resultado, RESULTADO_CONFIRMACAO.NEGADO);
});

test('Confirmacao: texto vazio e ambiguo, nunca confirmado', () => {
  assert.equal(interpretarConfirmacao({ texto: '' }).resultado, RESULTADO_CONFIRMACAO.AMBIGUO);
  assert.equal(interpretarConfirmacao({}).resultado, RESULTADO_CONFIRMACAO.AMBIGUO);
});

// ---------------------------------------------------------------------------
// Aritmetica de tempo (a garantia de "numero sai de codigo")
// ---------------------------------------------------------------------------

test('Tempo: conversoes HH:MM:SS', () => {
  assert.equal(tempoParaSegundos('01:30:00'), 5400);
  assert.equal(tempoParaSegundos('00:45'), 2700);
  assert.equal(tempoParaSegundos(''), 0);
  assert.equal(tempoParaSegundos(null), 0);
  assert.equal(tempoParaSegundos('lixo'), 0);
  // Tempo negativo so vem de dado corrompido; zerar evita contaminar totais.
  assert.equal(tempoParaSegundos('-01:00:00'), 0);
  assert.equal(segundosParaTempo(5400), '01:30:00');
  assert.equal(segundosParaTempo(0), '00:00:00');
});

test('Tempo: forma humana', () => {
  assert.equal(segundosParaTextoHumano(0), '0min');
  assert.equal(segundosParaTextoHumano(2700), '45min');
  assert.equal(segundosParaTextoHumano(3600), '1h');
  assert.equal(segundosParaTextoHumano(5400), '1h30');
  assert.equal(segundosParaTextoHumano(22500), '6h15');
});

test('Tempo: soma total e quebra por dimensao', () => {
  const atividades = [
    { tempo: '02:30:00', projeto: 'Rede Pró' },
    { tempo: '01:45:00', projeto: 'Rede Pró' },
    { tempo: '01:00:00', projeto: 'Tracbel' },
    { tempo: '', projeto: 'Tracbel' }
  ];

  // 2h30 + 1h45 + 1h + (vazio = 0) = 5h15
  const r = somarTempoAtividades(atividades, { agruparPor: 'projeto' });
  assert.equal(r.quantidade, 4);
  assert.equal(r.totalSegundos, 18900);
  assert.equal(r.formatado, '05:15:00');
  assert.equal(r.humano, '5h15');

  // Quebra vem ordenada do maior para o menor.
  assert.equal(r.quebra[0].chave, 'Rede Pró');
  assert.equal(r.quebra[0].totalSegundos, 15300);
  assert.equal(r.quebra[1].chave, 'Tracbel');
  assert.equal(r.quebra[1].quantidade, 2);
});

test('Tempo: campo de agrupamento vazio vira rotulo explicito', () => {
  const r = somarTempoAtividades([{ tempo: '01:00:00', projeto: '' }], { agruparPor: 'projeto' });
  assert.equal(r.quebra[0].chave, '(sem classificação)');
});

test('Tempo: lista vazia nao quebra', () => {
  const r = somarTempoAtividades([]);
  assert.equal(r.totalSegundos, 0);
  assert.equal(r.formatado, '00:00:00');
});

// ---------------------------------------------------------------------------
// Resolucao de nomes falados
// ---------------------------------------------------------------------------

test('Entidade: casa variacoes de grafia, acento e espacamento', () => {
  const projetos = ['Projetos - Rede Pró', 'Projetos - Tracbel', 'Interno'];
  for (const consulta of ['rede pro', 'RedePRO', 'Rede Pró', 'rede  pró']) {
    const r = resolverEntidade(consulta, projetos);
    assert.equal(r.encontrado, true, `"${consulta}" deveria casar`);
    assert.equal(r.valor, 'Projetos - Rede Pró');
  }
});

test('Entidade: erro de digitacao ainda casa', () => {
  const r = resolverEntidade('tracbell', ['Projetos - Tracbel', 'Interno']);
  assert.equal(r.encontrado, true);
  assert.equal(r.valor, 'Projetos - Tracbel');
});

test('Entidade: nome desconhecido devolve alternativas em vez de chutar', () => {
  const r = resolverEntidade('xpto', ['Projetos - Rede Pró', 'Interno']);
  assert.equal(r.encontrado, false);
  assert.equal(r.motivo, 'sem_correspondencia');
  assert.deepEqual(r.alternativas, ['Projetos - Rede Pró', 'Interno']);
});

test('Entidade: ambiguidade real nao e resolvida por chute', () => {
  const r = resolverEntidade('agente de', ['Agente de Catálogo', 'Agente de Vendas']);
  assert.equal(r.encontrado, false);
  assert.equal(r.motivo, 'ambiguo');
  assert.equal(r.alternativas.length, 2);
});

test('Entidade: acerto exato vence candidato mais longo que contem a consulta', () => {
  const r = resolverEntidade('Interno', ['Interno', 'Reunião interna [Projeto deve ser interno]']);
  assert.equal(r.valor, 'Interno');
});

// ---------------------------------------------------------------------------
// Periodos (deterministicos, com data injetada)
// ---------------------------------------------------------------------------

// Quarta-feira, 30/09/2026. Semana segunda-a-domingo: 28/09 a 04/10.
const HOJE = new Date(2026, 8, 30);

test('Periodo: padrao e a semana atual (segunda a domingo)', () => {
  const r = resolverPeriodo('', { hoje: HOJE });
  assert.equal(r.start, '2026-09-28');
  assert.equal(r.end, '2026-10-04');
  assert.equal(r.semana, '28/09 a 04/10');
});

test('Periodo: semana passada', () => {
  const r = resolverPeriodo('semana passada', { hoje: HOJE });
  assert.equal(r.start, '2026-09-21');
  assert.equal(r.end, '2026-09-27');
});

test('Periodo: hoje e ontem', () => {
  assert.equal(resolverPeriodo('hoje', { hoje: HOJE }).start, '2026-09-30');
  assert.equal(resolverPeriodo('ontem', { hoje: HOJE }).start, '2026-09-29');
});

test('Periodo: mes atual e mes passado respeitam o ultimo dia', () => {
  const atual = resolverPeriodo('este mês', { hoje: HOJE });
  assert.equal(atual.start, '2026-09-01');
  assert.equal(atual.end, '2026-09-30');

  const passado = resolverPeriodo('mês passado', { hoje: HOJE });
  assert.equal(passado.start, '2026-08-01');
  assert.equal(passado.end, '2026-08-31');
});

test('Periodo: mes nomeado, com e sem ano', () => {
  assert.equal(resolverPeriodo('setembro', { hoje: HOJE }).start, '2026-09-01');
  const comAno = resolverPeriodo('março de 2025', { hoje: HOJE });
  assert.equal(comAno.start, '2025-03-01');
  assert.equal(comAno.end, '2025-03-31');
});

test('Periodo: ultimos N dias', () => {
  const r = resolverPeriodo('últimos 7 dias', { hoje: HOJE });
  assert.equal(r.start, '2026-09-24');
  assert.equal(r.end, '2026-09-30');
});

test('Periodo: rotulo de semana ja gravado nas atividades', () => {
  const r = resolverPeriodo('22/09 a 28/09', { hoje: HOJE });
  assert.equal(r.semana, '22/09 a 28/09');
});

test('Periodo: expressao desconhecida e sinalizada, nao silenciosamente trocada', () => {
  // Cair na semana atual em silencio esconderia do usuario que ele pediu
  // algo que o sistema nao entendeu.
  const r = resolverPeriodo('quando deu aquela confusão', { hoje: HOJE });
  assert.equal(r.naoReconhecido, true);
  assert.equal(r.start, null);
});

// ---------------------------------------------------------------------------
// Invariantes de ferramenta e de card
// ---------------------------------------------------------------------------

test('Ferramenta: declarar userId como parametro e proibido', () => {
  // Se o modelo pudesse escolher o userId, uma injecao de prompt vazaria
  // dados entre contas. A proibicao e estrutural, nao uma convencao.
  assert.throws(() => definirFerramenta({
    nome: 'ruim',
    descricao: 'x',
    parametros: { type: 'object', properties: { userId: { type: 'string' } } },
    executar: async () => ({})
  }), /Identidade do usuario e injetada/);

  assert.throws(() => definirFerramenta({
    nome: 'ruim2',
    descricao: 'x',
    parametros: { type: 'object', properties: { user_id: { type: 'string' } } },
    executar: async () => ({})
  }), /Identidade do usuario e injetada/);
});

test('Ferramenta: exige nome e executar', () => {
  assert.throws(() => definirFerramenta({ descricao: 'x', executar: async () => ({}) }), /exige "nome"/);
  assert.throws(() => definirFerramenta({ nome: 'a', descricao: 'x' }), /exige "executar"/);
});

test('AgentCard: exige id, name e description', () => {
  assert.throws(() => criarAgentCard({ name: 'x', description: 'y' }), /exige "id"/);
  assert.throws(() => criarAgentCard({ id: 'x', description: 'y' }), /exige "name"/);
  assert.throws(() => criarAgentCard({ id: 'x', name: 'y' }), /exige "description"/);
});

test('Message: texto e dados sao extraidos das parts corretas', () => {
  const m = mensagemAgente('Você gastou 6h15', { totalSegundos: 22500 });
  assert.equal(extrairTexto(m), 'Você gastou 6h15');
  assert.deepEqual(extrairDados(m), { totalSegundos: 22500 });
});
