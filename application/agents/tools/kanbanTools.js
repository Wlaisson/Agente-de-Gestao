import {
  definirFerramenta,
  resultadoOk,
  resultadoErro,
  resultadoProposta
} from '../runtime/definirFerramenta.js';
import { resolverEntidade } from '../../../domain/services/ResolverEntidade.js';
import { resolverPeriodo, paraIsoData } from '../../../domain/services/ResolverPeriodo.js';

// Ferramentas de tarefas (Kanban).
//
// As duas de escrita (`propor_criar_tarefa`, `propor_mover_tarefa`) NAO
// gravam nada - o nome e literal. Elas devolvem uma proposta que sobe ate o
// usuario como `input-required`; a gravacao acontece depois, no executor
// registrado no wiring, com os dados exatos que foram aprovados.
//
// O motivo de o modelo nao gravar direto: uma frase como "a tarefa da
// RedePRO ja pode fechar" e ambigua (qual tarefa? fechar = concluida ou
// cancelada?). Errar uma leitura custa uma correcao; errar uma escrita
// corrompe o quadro de trabalho da pessoa.

const STATUS_VALIDOS = ['A Fazer', 'Em Andamento', 'Concluído'];
const PRIORIDADES_VALIDAS = ['Baixa', 'Média', 'Alta'];

function resumirCard(c) {
  return {
    id: c.id,
    titulo: c.titulo,
    descricao: c.descricao,
    projeto: c.projeto,
    assunto: c.assuntoInterno,
    status: c.status,
    prioridade: c.prioridade,
    prazo: c.prazo || null,
    criadaEm: c.dataCriacao || null,
    // Card legado, gravado antes do escopo por usuario existir. O agente
    // precisa saber para nao afirmar que a tarefa e do usuario que perguntou.
    semDonoRegistrado: !!c.semDono
  };
}

// Prazo vencido/proximo e conta de calendario, nao de modelo: "atrasada" tem
// que significar a mesma coisa toda vez que for perguntado.
function classificarPrazo(prazo, hojeIso) {
  if (!prazo) return { situacao: 'sem-prazo', diasRestantes: null };
  const prazoIso = String(prazo).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prazoIso)) return { situacao: 'prazo-invalido', diasRestantes: null };

  const msPorDia = 86400000;
  const dias = Math.round((new Date(prazoIso).getTime() - new Date(hojeIso).getTime()) / msPorDia);

  if (dias < 0) return { situacao: 'atrasada', diasRestantes: dias };
  if (dias === 0) return { situacao: 'vence-hoje', diasRestantes: 0 };
  if (dias <= 3) return { situacao: 'vence-em-breve', diasRestantes: dias };
  return { situacao: 'no-prazo', diasRestantes: dias };
}

export function criarKanbanTools({ listarCards, obterOpcoes, hoje = () => new Date() }) {
  async function cardsDoUsuario(userId) {
    // `incluirSemDono` mantem visiveis os cards legados (user_id nulo). Sem
    // isso o agente diria "voce nao tem tarefas" para quem tem o quadro
    // cheio, ate o backfill rodar.
    const cards = await listarCards({ userId, incluirSemDono: true });
    return Array.isArray(cards) ? cards : [];
  }

  const listarTarefas = definirFerramenta({
    nome: 'listar_tarefas',
    descricao:
      'Lista as tarefas do quadro Kanban do usuário, com filtros opcionais por status, projeto ou ' +
      'situação de prazo. Use para "o que está pendente", "o que está atrasado", "quais as próximas ' +
      'etapas do projeto X" e para montar a seção de próximas etapas de uma apresentação.',
    parametros: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: STATUS_VALIDOS,
          description: 'Filtra por status. Opcional.'
        },
        projeto: {
          type: 'string',
          description: 'Nome do projeto como o usuário falou. Opcional.'
        },
        apenasAtrasadas: {
          type: 'boolean',
          description: 'Se verdadeiro, devolve só tarefas com prazo vencido.'
        }
      },
      required: []
    },
    executar: async ({ status, projeto, apenasAtrasadas }, contexto) => {
      let cards = await cardsDoUsuario(contexto.userId);
      const hojeIso = paraIsoData(hoje());
      const filtros = {};

      if (status) {
        cards = cards.filter(c => c.status === status);
        filtros.status = status;
      }

      if (projeto) {
        const universo = [...new Set(cards.map(c => c.projeto).filter(Boolean))];
        const resolucao = resolverEntidade(projeto, universo);
        if (!resolucao.encontrado) {
          return resultadoErro(
            `Nenhuma tarefa de um projeto parecido com "${projeto}".`,
            {
              sugestao: 'Confirme o projeto com o usuário.',
              alternativas: resolucao.alternativas
            }
          );
        }
        cards = cards.filter(c => c.projeto === resolucao.valor);
        filtros.projeto = resolucao.valor;
      }

      const comPrazo = cards.map(c => ({ ...resumirCard(c), ...classificarPrazo(c.prazo, hojeIso) }));
      const final = apenasAtrasadas ? comPrazo.filter(c => c.situacao === 'atrasada') : comPrazo;

      return resultadoOk({
        filtrosAplicados: filtros,
        quantidade: final.length,
        porStatus: STATUS_VALIDOS.reduce((acc, s) => {
          acc[s] = final.filter(c => c.status === s).length;
          return acc;
        }, {}),
        tarefas: final
      }, { resumo: `${final.length} tarefa(s).` });
    }
  });

  const proporCriarTarefa = definirFerramenta({
    nome: 'propor_criar_tarefa',
    descricao:
      'Prepara a criação de uma tarefa no Kanban. NÃO cria nada: devolve uma proposta que precisa ' +
      'da confirmação do usuário. Use quando o usuário pedir para anotar, criar ou registrar uma tarefa.',
    escrita: true,
    parametros: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto e objetivo da tarefa.' },
        descricao: { type: 'string', description: 'Detalhamento da tarefa.' },
        projeto: { type: 'string', description: 'Projeto ao qual a tarefa pertence.' },
        assunto: { type: 'string', description: 'Assunto interno.' },
        prioridade: { type: 'string', enum: PRIORIDADES_VALIDAS },
        prazo: {
          type: 'string',
          description: 'Prazo em linguagem natural ("sexta", "amanhã") ou ISO (AAAA-MM-DD). Opcional.'
        }
      },
      required: ['titulo']
    },
    executar: async ({ titulo, descricao = '', projeto = '', assunto = '', prioridade = 'Média', prazo = '' }, contexto) => {
      if (!titulo || !titulo.trim()) {
        return resultadoErro('Título é obrigatório para criar uma tarefa.');
      }

      // Normaliza projeto/assunto contra o cadastro para o card nascer com
      // o mesmo vocabulario do resto do sistema (senao os filtros do quadro
      // e dos relatorios deixam de encontra-lo).
      let opcoes = {};
      try {
        opcoes = (await obterOpcoes()) || {};
      } catch (e) {
        console.log('Opções aviso:', e.message);
      }

      const avisos = [];
      let projetoFinal = projeto;
      if (projeto) {
        const r = resolverEntidade(projeto, opcoes.projetos || []);
        if (r.encontrado) projetoFinal = r.valor;
        else avisos.push(`O projeto "${projeto}" não está cadastrado; será gravado como informado.`);
      }

      let assuntoFinal = assunto;
      if (assunto) {
        const r = resolverEntidade(assunto, opcoes.assuntosInternos || []);
        if (r.encontrado) assuntoFinal = r.valor;
        else avisos.push(`O assunto "${assunto}" não está cadastrado; será gravado como informado.`);
      }

      let prazoFinal = '';
      if (prazo) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(prazo.trim())) {
          prazoFinal = prazo.trim();
        } else {
          const intervalo = resolverPeriodo(prazo, { hoje: hoje() });
          if (intervalo.naoReconhecido || !intervalo.end) {
            avisos.push(`Não consegui converter o prazo "${prazo}" em data; a tarefa ficará sem prazo.`);
          } else {
            prazoFinal = intervalo.end;
          }
        }
      }

      return resultadoProposta({
        tipo: 'criar_tarefa',
        descricao: `Criar tarefa "${titulo}"${projetoFinal ? ` no projeto ${projetoFinal}` : ''}${prazoFinal ? `, prazo ${prazoFinal}` : ''}.`,
        impacto: 'baixo',
        dados: {
          titulo: titulo.trim(),
          descricao,
          projeto: projetoFinal,
          assuntoInterno: assuntoFinal,
          prioridade: PRIORIDADES_VALIDAS.includes(prioridade) ? prioridade : 'Média',
          prazo: prazoFinal,
          status: 'A Fazer',
          avisos
        }
      });
    }
  });

  const proporMoverTarefa = definirFerramenta({
    nome: 'propor_mover_tarefa',
    descricao:
      'Prepara a mudança de status de uma tarefa existente. NÃO altera nada: devolve uma proposta ' +
      'que precisa de confirmação. Use para "marca como concluída", "move para em andamento".',
    escrita: true,
    parametros: {
      type: 'object',
      properties: {
        tarefa: {
          type: 'string',
          description: 'Título da tarefa como o usuário se referiu a ela, ou o id exato se você já o conhece.'
        },
        novoStatus: { type: 'string', enum: STATUS_VALIDOS }
      },
      required: ['tarefa', 'novoStatus']
    },
    executar: async ({ tarefa, novoStatus }, contexto) => {
      if (!STATUS_VALIDOS.includes(novoStatus)) {
        return resultadoErro(`Status inválido: "${novoStatus}". Use um de: ${STATUS_VALIDOS.join(', ')}.`);
      }

      const cards = await cardsDoUsuario(contexto.userId);
      if (cards.length === 0) return resultadoErro('O usuário não tem tarefas no quadro.');

      // Id exato tem precedencia: se o agente ja listou as tarefas, ele
      // consegue apontar sem ambiguidade.
      let alvo = cards.find(c => c.id === tarefa);

      if (!alvo) {
        const resolucao = resolverEntidade(tarefa, cards.map(c => c.titulo));
        if (!resolucao.encontrado) {
          return resultadoErro(
            resolucao.motivo === 'ambiguo'
              ? `Mais de uma tarefa parecida com "${tarefa}".`
              : `Nenhuma tarefa parecida com "${tarefa}".`,
            {
              sugestao: 'Liste as tarefas e peça ao usuário para escolher qual é.',
              alternativas: resolucao.alternativas
            }
          );
        }
        // Titulos podem repetir entre projetos; se repetirem, e ambiguidade
        // real e o usuario precisa desempatar.
        const candidatos = cards.filter(c => c.titulo === resolucao.valor);
        if (candidatos.length > 1) {
          return resultadoErro(
            `Existem ${candidatos.length} tarefas com o título "${resolucao.valor}".`,
            {
              sugestao: 'Peça ao usuário para indicar o projeto da tarefa correta.',
              alternativas: candidatos.map(c => `${c.titulo} (projeto: ${c.projeto || 'sem projeto'})`)
            }
          );
        }
        alvo = candidatos[0];
      }

      if (alvo.status === novoStatus) {
        return resultadoErro(`A tarefa "${alvo.titulo}" já está em "${novoStatus}". Nada a fazer.`);
      }

      return resultadoProposta({
        tipo: 'mover_tarefa',
        descricao: `Mover "${alvo.titulo}" de "${alvo.status}" para "${novoStatus}".`,
        impacto: novoStatus === 'Concluído' ? 'medio' : 'baixo',
        dados: { id: alvo.id, titulo: alvo.titulo, statusAnterior: alvo.status, novoStatus }
      });
    }
  });

  return [listarTarefas, proporCriarTarefa, proporMoverTarefa];
}
