// Guarda contra envenenamento de few-shot.
//
// BUG REAL QUE ORIGINOU ESTE ARQUIVO: os exemplos do orquestrador traziam
// "Nesta semana (22/09 a 28/09)" e a persona ilustrava a delegação com
// "Some o tempo do projeto Rede Pró na semana de 22/09 a 28/09". O modelo
// copiou a data do exemplo para o pedido real: o usuário perguntou sobre
// "essa semana" (28/09 a 04/10) e o sistema consultou a semana ANTERIOR,
// respondendo "não houve nenhuma atividade" para uma semana cheia.
//
// O sintoma é traiçoeiro porque a resposta parece legítima - não há erro,
// só o recorte errado. Daí um teste estrutural em vez de confiar em revisão.
//
// A regra: prompt de agente não carrega valor concreto que o modelo possa
// confundir com dado. Datas viram ‹placeholder›; formatos de parâmetro usam
// máscara (DD/MM, AAAA-MM-DD) em vez de uma data de exemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ_AGENTES = 'application/agents';

// Datas concretas: 22/09, 03/10/2026, 2026-09-01.
const DATA_CONCRETA = /\b(\d{2}\/\d{2}(\/\d{4})?|\d{4}-\d{2}-\d{2})\b/g;

// Máscaras são o que queremos ENCONTRAR no lugar das datas.
const MASCARAS = /\b(DD\/MM|AAAA-MM-DD|MM\/AAAA)\b/;

function arquivosDePrompt() {
  const encontrados = [];
  const visitar = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(caminho);
      } else if (entrada.name.endsWith('.js')) {
        encontrados.push(caminho);
      }
    }
  };
  visitar(RAIZ_AGENTES);
  return encontrados;
}

// Comentários explicam o porquê (inclusive citando o bug e a data dele) e
// não entram no prompt - só o código conta.
function removerComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('Prompts dos agentes não contêm datas concretas', () => {
  const violacoes = [];

  for (const arquivo of arquivosDePrompt()) {
    const fonte = removerComentarios(readFileSync(arquivo, 'utf8'));

    for (const linha of fonte.split('\n')) {
      const achados = linha.match(DATA_CONCRETA);
      if (!achados) continue;
      // Uma linha que ensina a máscara ("um rótulo de semana (DD/MM a DD/MM)")
      // é exatamente o que queremos; não conta como violação.
      if (MASCARAS.test(linha)) continue;
      violacoes.push(`${arquivo}: ${achados.join(', ')}  →  ${linha.trim().slice(0, 90)}`);
    }
  }

  assert.deepEqual(
    violacoes,
    [],
    'Data concreta em prompt de agente. O modelo copia esse valor para a resposta real ' +
    '(foi o que fez o sistema consultar a semana errada). Troque por ‹placeholder› ou por ' +
    'máscara (DD/MM, AAAA-MM-DD).\n' + violacoes.join('\n')
  );
});

test('A convenção ‹placeholder› é explicada ao modelo', () => {
  // Sem a explicação, o modelo escreve os sinais ‹ › literalmente na
  // resposta - troca um defeito por outro.
  const builder = readFileSync('shared/promptBuilderConversacional.js', 'utf8');
  assert.match(builder, /‹/, 'O builder precisa mencionar a convenção de placeholder.');
  // Regex tolerante à quebra da string em várias linhas concatenadas, que é
  // como o bloco é montado no builder.
  assert.match(
    builder,
    /escreva os sinais/i,
    'O builder precisa instruir o modelo a não emitir os sinais ‹ › na resposta.'
  );
});

test('Agentes que citam período têm negativa contra reaproveitar valor de exemplo', () => {
  // A negativa é a segunda linha de defesa: mesmo sem data no exemplo, o
  // modelo pode inventar um intervalo. Quem fala de período precisa ser
  // avisado explicitamente.
  const obrigatorios = [
    'application/agents/orchestrator/OrchestratorAgent.js',
    'application/agents/analista/analistaPromptConfig.js',
    'application/agents/redator/redatorPromptConfig.js'
  ];

  for (const arquivo of obrigatorios) {
    const fonte = readFileSync(arquivo, 'utf8');
    assert.match(
      fonte,
      /Nunca copie valores literais dos exemplos/,
      `${arquivo} precisa da negativa contra copiar valores dos exemplos.`
    );
  }
});

test('O orquestrador é instruído a repassar o período na fala do usuário', () => {
  // A correção estrutural do bug: quem resolve "essa semana" em datas é o
  // ResolverPeriodo (que conhece a data de hoje), nunca o modelo.
  const fonte = readFileSync('application/agents/orchestrator/OrchestratorAgent.js', 'utf8');
  assert.match(fonte, /repasse a expressão EXATAMENTE como o usuário falou/i);
  assert.match(fonte, /[Nn]unca converta em datas/);
});
