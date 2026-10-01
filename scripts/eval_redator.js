// Harness de Avaliação (Eval) do Agente Redator.
//
// POR QUE EXISTE:
// Os testes automatizados em `test/` validam o encanamento do sistema com
// mocks determinísticos, mas não chamam a OpenAI. Este script é o harness
// de qualidade real do agente Redator: roda casos reais contra a OpenAI e
// aplica CHECAGENS DETERMINÍSTICAS (baratas, rápidas e sem alucinação de juiz):
//
// 1. Números presentes na entrada aparecem na saída (fidelidade).
// 2. Nenhum número inventado aparece (detector de alucinação numérica).
// 3. Status restrito ao vocabulário fechado de cada formato (Weekly vs AI Estratégica).
// 4. Formato estrito de bullets (`**[Categoria]:** texto`) e tabelas Markdown.
// 5. Impessoalidade: ausência de termos em 1ª pessoa ("fiz", "atendi").
// 6. Respeito às negativas (ex.: nunca incluir Daily/reunião interna no cliente).
//
// COMO USAR:
//   node scripts/eval_redator.js                     -> roda todos os casos
//   node scripts/eval_redator.js --caso 1            -> roda apenas o caso 1
//   node scripts/eval_redator.js --caso redepro      -> busca caso por id/título
//   node scripts/eval_redator.js --verbose           -> imprime a saída completa
//   node scripts/eval_redator.js --diff              -> compara com a saída esperada
//   node scripts/eval_redator.js --dry-run           -> valida o gabarito sem gastar tokens
//   node scripts/eval_redator.js --modelo gpt-4o     -> testa com modelo específico

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { supabaseAdmin } from '../supabaseClient.js';
import { createOpenAIGateway } from '../interface-adapters/gateways/OpenAIGateway.js';
import { openaiGlobal, MODELOS } from '../infrastructure/openai/openaiClient.js';
import { createAgentRuntime } from '../application/agents/runtime/AgentRuntime.js';
import { createToolExecutor } from '../application/agents/runtime/ToolExecutor.js';
import { tracerNulo } from '../infrastructure/tracing/Tracer.js';
import { criarAtividadesTools } from '../application/agents/tools/atividadesTools.js';
import { criarKanbanTools } from '../application/agents/tools/kanbanTools.js';
import { criarRedatorAgent } from '../application/agents/redator/RedatorAgent.js';
import {
  STATUS_AI_ESTRATEGICA,
  STATUS_WEEKLY
} from '../application/agents/redator/redatorPromptConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASOS_FILE = path.join(__dirname, '..', 'test', 'evals', 'casos-redator.json');

// --- Cores para o terminal --------------------------------------------------
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// --- Parse de argumentos da CLI ---------------------------------------------
const args = process.argv.slice(2);

function obterArg(nome) {
  const idx = args.indexOf(nome);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const flagAjuda = args.includes('--help') || args.includes('-h');
const flagVerbose = args.includes('--verbose') || args.includes('-v');
const flagDiff = args.includes('--diff');
const flagDryRun = args.includes('--dry-run');
const filtroCaso = obterArg('--caso') || obterArg('-c');
const modeloOverride = obterArg('--modelo') || obterArg('-m');

if (flagAjuda) {
  console.log(`
${c.bold}Harness de Avaliação do Agente Redator (WMA Report)${c.reset}

Uso:
  node scripts/eval_redator.js [opções]

Opções:
  --caso, -c <id|num>   Roda apenas o caso especificado (por índice 1-indexed ou substring do ID).
  --verbose, -v         Exibe o texto completo gerado pelo modelo e detalhes das checagens.
  --diff                Mostra comparação lado a lado entre o gerado e o gabarito.
  --dry-run             Roda os testes determinísticos contra o gabarito sem chamar a OpenAI.
  --modelo, -m <nome>   Sobrescreve o modelo a testar (ex.: gpt-4o-mini, gpt-4o, gpt-5-nano).
  --help, -h            Exibe esta ajuda.
`);
  process.exit(0);
}

// --- Carregamento dos Casos -------------------------------------------------
if (!fs.existsSync(CASOS_FILE)) {
  console.error(`${c.red}Arquivo de casos não encontrado:${c.reset} ${CASOS_FILE}`);
  process.exit(1);
}

const todosOsCasos = JSON.parse(fs.readFileSync(CASOS_FILE, 'utf8'));

let casosParaRodar = todosOsCasos;
if (filtroCaso) {
  const num = parseInt(filtroCaso, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= todosOsCasos.length) {
    casosParaRodar = [todosOsCasos[num - 1]];
  } else {
    casosParaRodar = todosOsCasos.filter(caso =>
      caso.id.toLowerCase().includes(filtroCaso.toLowerCase()) ||
      caso.titulo.toLowerCase().includes(filtroCaso.toLowerCase())
    );
  }

  if (casosParaRodar.length === 0) {
    console.error(`${c.red}Nenhum caso encontrado para o filtro:${c.reset} "${filtroCaso}"`);
    process.exit(1);
  }
}

// --- Configuração da OpenAI -------------------------------------------------
const openAIGateway = createOpenAIGateway({
  supabaseAdmin,
  openaiGlobal,
  modelosPadrao: modeloOverride ? [modeloOverride] : MODELOS
});

// --- Motor de Checagens Determinísticas -------------------------------------

// Extrai todos os números inteiros do texto.
function extrairNumeros(texto) {
  if (!texto) return [];
  const matches = texto.match(/\b\d+\b/g);
  return matches ? matches.map(n => parseInt(n, 10)) : [];
}

// Extrai números permitidos do contexto do caso (atividades, datas, etc).
function extrairNumerosPermitidos(caso) {
  const permitidos = new Set();

  // Datas e anos comuns
  permitidos.add(2026);
  permitidos.add(2025);

  // Números presentes nas atividades de entrada (título, descrição, tempo)
  for (const atv of caso.atividadesDeEntrada || []) {
    const textoCompleto = `${atv.titulo || ''} ${atv.atividade || ''} ${atv.tempo || ''}`;
    extrairNumeros(textoCompleto).forEach(n => permitidos.add(n));
  }

  // Quantidade total de atividades e números de ordenação comuns (1 a 10)
  const totalAtividades = (caso.atividadesDeEntrada || []).length;
  permitidos.add(totalAtividades);
  for (let i = 1; i <= 10; i++) permitidos.add(i);

  // Adiciona números do período se aplicável (ex: "22/09 a 28/09")
  if (caso.semana) {
    extrairNumeros(caso.semana).forEach(n => permitidos.add(n));
  }

  // Números explícitos do critério
  if (caso.criterios?.numerosObrigatorios) {
    caso.criterios.numerosObrigatorios.forEach(n => permitidos.add(n));
  }

  return permitidos;
}

function checarDeterminismo(textoGerado, caso) {
  const falhas = [];
  const avisos = [];
  const criterios = caso.criterios || {};

  if (!textoGerado || typeof textoGerado !== 'string' || !textoGerado.trim()) {
    return {
      passou: false,
      falhas: ['Modelo retornou resposta vazia ou inválida.'],
      avisos: []
    };
  }

  // 1. Caso de borda: projeto sem atividades
  if (caso.formato === 'borda') {
    if (criterios.termosObrigatorios) {
      for (const termo of criterios.termosObrigatorios) {
        if (!new RegExp(termo, 'i').test(textoGerado)) {
          falhas.push(`Mensagem de ausência de atividades não contém "${termo}".`);
        }
      }
    }
    return { passou: falhas.length === 0, falhas, avisos };
  }

  // 2. Números obrigatórios presentes
  if (criterios.numerosObrigatorios && Array.isArray(criterios.numerosObrigatorios)) {
    for (const num of criterios.numerosObrigatorios) {
      // Regex que aceita o número solto ou com zero à esquerda (ex: 2 ou 02)
      const padrao = new RegExp(`\\b0*${num}\\b`);
      if (!padrao.test(textoGerado)) {
        falhas.push(`Número esperado "${num}" não foi encontrado no texto gerado.`);
      }
    }
  }

  // 3. Detector de alucinação numérica (números inventados pelo modelo)
  if (criterios.detectorAlucinacaoNumerica) {
    const permitidos = extrairNumerosPermitidos(caso);
    const numerosNoTexto = extrairNumeros(textoGerado);
    const inventados = numerosNoTexto.filter(n => !permitidos.has(n));

    if (inventados.length > 0) {
      falhas.push(`Possível alucinação numérica: números [${[...new Set(inventados)].join(', ')}] não constam nas atividades.`);
    }
  }

  // 4. Vocabulário fechado de status
  if (caso.formato === 'ai-estrategica') {
    const statusValidos = STATUS_AI_ESTRATEGICA;
    const proibidos = criterios.statusProibidos || ['Em andamento', 'Fazendo', 'Finalizado', 'Em aberto'];

    for (const p of proibidos) {
      if (new RegExp(`\\b${p}\\b`, 'i').test(textoGerado)) {
        falhas.push(`Status proibido "${p}" encontrado na AI Estratégica. Permitidos apenas: ${statusValidos.join(', ')}.`);
      }
    }
  } else if (caso.formato === 'weekly' && textoGerado.includes('Próximas etapas')) {
    const statusValidos = STATUS_WEEKLY;
    const proibidos = ['Fazendo', 'Finalizado', 'Em progresso', 'Em backlog'];
    for (const p of proibidos) {
      if (new RegExp(`\\b${p}\\b`, 'i').test(textoGerado)) {
        falhas.push(`Status proibido "${p}" encontrado no Weekly. Permitidos apenas: ${statusValidos.join(', ')}.`);
      }
    }
  }

  // 5. Formato de bullets do Weekly: **[Categoria]:** texto
  if (criterios.exigirFormatoBullet && caso.formato === 'weekly') {
    const temBulletCategoria = /-\s*\*\*\[[^\]]+\]:\*\*/.test(textoGerado) || /\*\*\[[^\]]+\]:\*\*/.test(textoGerado);
    if (!temBulletCategoria) {
      falhas.push('Formato de bullet violado: não foi encontrado o padrão "**[Categoria]:** texto" nos itens.');
    }
  }

  // 6. Tabela Markdown na AI Estratégica
  if (criterios.exigirTabelaMarkdown && caso.formato === 'ai-estrategica') {
    const temCabecalhoTabela = /\|\s*Iniciativa\s*\|\s*Responsável\s*\|\s*Status\s*\|\s*Prazo\s*\|/i.test(textoGerado);
    if (!temCabecalhoTabela) {
      falhas.push('Tabela Markdown da AI Estratégica ausente ou com colunas fora do padrão "Iniciativa | Responsável | Status | Prazo".');
    }
  }

  // 7. Impessoalidade: proibição estrita de primeira pessoa
  if (criterios.proibirPrimeiraPessoa) {
    const primeiraPessoaRegex = /\b(eu|meu|minha|meus|minhas|fiz|fizemos|consegui|conseguimos|atendi|atendemos|atualizei)\b/i;
    const match = textoGerado.match(primeiraPessoaRegex);
    if (match) {
      falhas.push(`Uso de primeira pessoa detectado ("${match[0]}"). O texto deve ser impessoal.`);
    }
  }

  // 8. Termos proibidos específicos (ex: Daily em cliente ou grafia "Process")
  if (criterios.termosProibidos && Array.isArray(criterios.termosProibidos)) {
    for (const termo of criterios.termosProibidos) {
      if (new RegExp(`\\b${termo}\\b`, 'i').test(textoGerado)) {
        falhas.push(`Termo proibido "${termo}" encontrado na saída.`);
      }
    }
  }

  // 9. Termos obrigatórios específicos (ex: Prosis)
  if (criterios.termosObrigatorios && Array.isArray(criterios.termosObrigatorios)) {
    for (const termo of criterios.termosObrigatorios) {
      if (!new RegExp(`\\b${termo}\\b`, 'i').test(textoGerado)) {
        falhas.push(`Termo obrigatório "${termo}" ausente da saída.`);
      }
    }
  }

  // 10. Marcação de campos a confirmar (SLA / QA)
  if (criterios.exigirMarcacaoAConfirmar) {
    const citaSlaOuQa = /SLA|Validações QA|QA/i.test(textoGerado);
    if (citaSlaOuQa) {
      const temConfirmacao = /a confirmar|confirmar por você/i.test(textoGerado);
      if (!temConfirmacao) {
        avisos.push('SLA/QA citado sem a observação de "a confirmar por você".');
      }
    }
  }

  return {
    passou: falhas.length === 0,
    falhas,
    avisos
  };
}

// --- Montagem do Agente Isolado por Caso ------------------------------------
function montarAgenteParaCaso({ caso, openAiConfig }) {
  // Mock em memória para este caso específico: garante determinismo dos dados
  const atividades = caso.atividadesDeEntrada || [];
  const cards = caso.tarefasDeEntrada || [];

  const listarAtividades = async ({ userId, todos, semana, start, end } = {}) => {
    let filtradas = atividades;
    if (semana) filtradas = filtradas.filter(a => a.semana === semana);
    return { data: filtradas, error: null };
  };

  const listarCards = async () => cards;

  const obterOpcoes = async () => ({
    projetos: [
      'Projetos - Rede Pró',
      'Projetos - Imdepa',
      'Projetos - Wurth',
      'Projetos - Tracbel',
      'Projetos - Campneus',
      'Interno'
    ],
    assuntosInternos: [
      'Cadastro de Produtos',
      'Carga de Catálogo',
      'Enriquecimento de Dados',
      'Scraping',
      'Agentes de Catálogo',
      'Alinhamento Técnico',
      'Saneamento de Catálogo'
    ]
  });

  const obterPerfilUsuario = async () => ({
    nome_pdf: 'Wlaisson',
    empresa_pdf: 'WMA Gestão'
  });

  const toolExecutor = createToolExecutor({ tracer: tracerNulo });
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer: tracerNulo });

  const atividadesTools = criarAtividadesTools({
    listarAtividades,
    obterOpcoes,
    hoje: () => new Date('2026-09-25T12:00:00Z')
  });

  const kanbanTools = criarKanbanTools({
    listarCards,
    obterOpcoes,
    hoje: () => new Date('2026-09-25T12:00:00Z')
  });

  const listarTarefasTool = kanbanTools.find(f => f.nome === 'listar_tarefas');

  const redator = criarRedatorAgent({
    ferramentas: [...atividadesTools, listarTarefasTool],
    agentRuntime,
    obterPerfilUsuario
  });

  return { redator, agentRuntime };
}

// --- Execução Principal -----------------------------------------------------
async function executarHarness() {
  console.log(`\n${c.bold}======================================================================${c.reset}`);
  console.log(`${c.bold}  HARNESS DE AVALIAÇÃO — AGENTE REDATOR (EVALS DETERMINÍSTICOS)      ${c.reset}`);
  console.log(`${c.bold}======================================================================${c.reset}`);
  console.log(`Casos carregados: ${casosParaRodar.length} de ${todosOsCasos.length}`);
  console.log(`Modo: ${flagDryRun ? c.yellow + 'DRY-RUN (validação contra gabarito sem chamada à OpenAI)' : c.green + 'EXECUÇÃO REAL VIA OPENAI'}${c.reset}`);
  if (modeloOverride) console.log(`Modelo especificado: ${c.cyan}${modeloOverride}${c.reset}`);
  console.log('----------------------------------------------------------------------\n');

  let openAiConfig = null;
  if (!flagDryRun) {
    try {
      openAiConfig = await openAIGateway.obterCliente('usuario-eval');
    } catch (e) {
      // Se falhar com userId fake, tenta cliente global
      try {
        openAiConfig = await openAIGateway.obterCliente(null);
      } catch (e2) {
        console.error(`${c.red}Falha ao obter cliente da OpenAI:${c.reset} ${e2.message}`);
        console.error(`Dica: Defina a variável ${c.bold}OPENAI_API_KEY${c.reset} no arquivo .env ou no ambiente para rodar o eval.`);
        process.exit(1);
      }
    }
  }

  const resultados = [];
  let totalPassou = 0;

  for (let i = 0; i < casosParaRodar.length; i++) {
    const caso = casosParaRodar[i];
    const indiceStr = `[${i + 1}/${casosParaRodar.length}]`;
    process.stdout.write(`${c.dim}${indiceStr}${c.reset} ${c.bold}${caso.id}${c.reset} (${caso.titulo})... `);

    const inicio = Date.now();
    let textoGerado = '';
    let erroExecucao = null;

    if (flagDryRun) {
      // No dry-run, avalia o texto do próprio gabarito esperado
      // para validar se o gabarito satisfaz os critérios determinísticos
      textoGerado = (caso.saidaEsperada || '').replace(/<!--.*?-->\n?/g, '');
    } else {
      try {
        const { redator } = montarAgenteParaCaso({ caso, openAiConfig });
        const resposta = await redator.executar({
          mensagem: { parts: [{ kind: 'text', text: caso.pergunta }] },
          contexto: {
            userId: 'user-eval-001',
            contextId: `eval-${caso.id}-${Date.now()}`
          },
          openAiConfig
        });
        textoGerado = resposta.texto || '';
      } catch (err) {
        erroExecucao = err;
      }
    }

    const duracaoMs = Date.now() - inicio;

    if (erroExecucao) {
      console.log(`${c.red}ERRO${c.reset} (${duracaoMs}ms)`);
      console.log(`   ${c.red}└ ${erroExecucao.message}${c.reset}`);
      resultados.push({ caso, passou: false, duracaoMs, falhas: [erroExecucao.message], avisos: [] });
      continue;
    }

    const avaliacao = checarDeterminismo(textoGerado, caso);

    if (avaliacao.passou) {
      totalPassou++;
      console.log(`${c.green}✔ PASS${c.reset} (${duracaoMs}ms)`);
    } else {
      console.log(`${c.red}✖ FAIL${c.reset} (${duracaoMs}ms)`);
      for (const falha of avaliacao.falhas) {
        console.log(`   ${c.red}└ Falha:${c.reset} ${falha}`);
      }
    }

    if (avaliacao.avisos.length > 0 && flagVerbose) {
      for (const aviso of avaliacao.avisos) {
        console.log(`   ${c.yellow}└ Aviso:${c.reset} ${aviso}`);
      }
    }

    if (flagVerbose) {
      console.log(`\n${c.cyan}--- Saída gerada (${caso.id}) ---${c.reset}`);
      console.log(textoGerado);
      console.log(`${c.cyan}--------------------------------${c.reset}\n`);
    }

    if (flagDiff) {
      console.log(`\n${c.yellow}--- Comparação (Esperado vs Gerado) ---${c.reset}`);
      console.log(`${c.bold}[ESPERADO]:${c.reset}\n${caso.saidaEsperada || '(sem gabarito)'}`);
      console.log(`${c.bold}[GERADO]:${c.reset}\n${textoGerado}`);
      console.log(`${c.yellow}---------------------------------------${c.reset}\n`);
    }

    resultados.push({
      caso,
      passou: avaliacao.passou,
      duracaoMs,
      falhas: avaliacao.falhas,
      avisos: avaliacao.avisos,
      textoGerado
    });
  }

  // --- Resumo Final ---------------------------------------------------------
  const taxaSucesso = ((totalPassou / casosParaRodar.length) * 100).toFixed(1);
  console.log('\n======================================================================');
  console.log(`${c.bold}PLACAR FINAL DO EVAL:${c.reset}`);
  console.log(`Total de Casos:  ${casosParaRodar.length}`);
  console.log(`Aprovados:       ${c.green}${totalPassou}${c.reset}`);
  console.log(`Reprovados:      ${totalPassou === casosParaRodar.length ? '0' : c.red + (casosParaRodar.length - totalPassou) + c.reset}`);
  console.log(`Taxa de Sucesso: ${totalPassou === casosParaRodar.length ? c.green : c.yellow}${taxaSucesso}%${c.reset}`);
  console.log('======================================================================\n');

  if (totalPassou < casosParaRodar.length) {
    console.log(`${c.yellow}Próximo passo:${c.reset} Use os resultados acima como insumo para ajustar os exemplos`);
    console.log(`em ${c.bold}application/agents/redator/redatorPromptConfig.js${c.reset} no PASSO 5.`);
  }
}

executarHarness().catch(err => {
  console.error(`${c.red}Erro inesperado no harness:${c.reset}`, err);
  process.exit(1);
});
