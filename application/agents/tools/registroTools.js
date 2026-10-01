import {
  definirFerramenta,
  resultadoErro,
  resultadoProposta
} from '../runtime/definirFerramenta.js';
import { resolverEntidade } from '../../../domain/services/ResolverEntidade.js';
import { resolverPeriodo, paraIsoData } from '../../../domain/services/ResolverPeriodo.js';
import { calcularSemanaDeData } from '../../../domain/services/WeekCalculator.js';
import { segundosParaTempo, tempoParaSegundos } from '../../../domain/services/TempoCalculator.js';

// Ferramenta de registro de atividade a partir de fala livre.
//
// E a unica escrita de dado historico do sistema, e por isso a mais
// conservadora: uma atividade errada contamina todos os relatorios que vierem
// depois (o Weekly, o Resumo Executivo, as somas de tempo). Duas travas:
//
// 1. Tempo e convertido por codigo, com vocabulario explicito ("2h30", "45
//    min", "1:30"). O modelo nao entrega segundos - entrega o que o usuario
//    falou, e a conversao e auditavel.
// 2. Campos que o usuario nao disse ficam VAZIOS e viram aviso na proposta.
//    Preencher projeto por dedução ("provavelmente é RedePRO") produz um
//    registro que parece correto e desvia o relatorio silenciosamente.

// "2h30", "2h", "90min", "1:30:00", "45m", "1 hora e meia"
function interpretarTempo(expressao) {
  const texto = String(expressao ?? '').trim().toLowerCase();
  if (!texto) return { segundos: 0, reconhecido: false };

  // Formato HH:MM ou HH:MM:SS ja canonico.
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(texto)) {
    return { segundos: tempoParaSegundos(texto), reconhecido: true };
  }

  const normalizado = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\be\s+meia\b/g, '30min')
    .replace(/\bmeia\s+hora\b/g, '30min');

  let segundos = 0;
  let achou = false;

  const horas = normalizado.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/);
  if (horas) {
    segundos += Math.round(parseFloat(horas[1].replace(',', '.')) * 3600);
    achou = true;
  }

  const minutos = normalizado.match(/(\d+)\s*(?:m|min|minuto|minutos)\b/);
  if (minutos) {
    segundos += parseInt(minutos[1], 10) * 60;
    achou = true;
  }

  // "2h30" sem unidade no segundo numero.
  if (horas && !minutos) {
    const composto = normalizado.match(/(\d+)\s*h\s*(\d{1,2})\b/);
    if (composto) {
      segundos = (parseInt(composto[1], 10) * 3600) + (parseInt(composto[2], 10) * 60);
      achou = true;
    }
  }

  // Numero solto nao e assumido como hora nem como minuto: "trabalhei 2
  // nisso" nao diz nada, e chutar erraria metade das vezes.
  return { segundos, reconhecido: achou };
}

export function criarRegistroTools({ obterOpcoes, hoje = () => new Date() }) {
  const proporRegistrarAtividade = definirFerramenta({
    nome: 'propor_registrar_atividade',
    descricao:
      'Prepara o registro de uma atividade já realizada. NÃO grava nada: devolve uma proposta que ' +
      'precisa da confirmação do usuário. Use quando ele relatar um trabalho feito ("hoje passei a ' +
      'manhã cadastrando SKU da Imdepa"). Preencha apenas o que o usuário realmente disse.',
    escrita: true,
    parametros: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto do que foi feito.' },
        descricao: { type: 'string', description: 'O que foi feito, com os detalhes que o usuário deu.' },
        projeto: { type: 'string', description: 'Projeto, apenas se o usuário disser. Não deduza.' },
        assunto: { type: 'string', description: 'Assunto interno, apenas se o usuário disser. Não deduza.' },
        tempo: {
          type: 'string',
          description: 'Tempo como o usuário falou: "2h30", "45 min", "1:30". Não converta você mesmo.'
        },
        data: {
          type: 'string',
          description: 'Quando foi: "hoje", "ontem" ou AAAA-MM-DD. Padrão: hoje.'
        }
      },
      required: ['titulo', 'descricao']
    },
    executar: async ({ titulo, descricao, projeto = '', assunto = '', tempo = '', data = 'hoje' }) => {
      if (!titulo?.trim() || !descricao?.trim()) {
        return resultadoErro('Título e descrição são obrigatórios para registrar uma atividade.');
      }

      const avisos = [];

      let dataFinal;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(data).trim())) {
        dataFinal = String(data).trim();
      } else {
        const intervalo = resolverPeriodo(data, { hoje: hoje() });
        if (intervalo.naoReconhecido || !intervalo.start) {
          dataFinal = paraIsoData(hoje());
          avisos.push(`Não entendi a data "${data}"; usei hoje (${dataFinal}).`);
        } else {
          // Periodo com mais de um dia vira o ultimo dia: uma atividade
          // precisa de uma data unica.
          dataFinal = intervalo.start === intervalo.end ? intervalo.start : intervalo.end;
          if (intervalo.start !== intervalo.end) {
            avisos.push(`"${data}" é um intervalo; registrei em ${dataFinal}. Corrija se não for isso.`);
          }
        }
      }

      const { segundos, reconhecido } = interpretarTempo(tempo);
      if (tempo && !reconhecido) {
        avisos.push(`Não consegui converter o tempo "${tempo}"; o registro ficará com 00:00:00.`);
      }
      if (!tempo) {
        avisos.push('Nenhum tempo informado; o registro ficará com 00:00:00.');
      }

      let opcoes = {};
      try {
        opcoes = (await obterOpcoes()) || {};
      } catch (e) {
        console.log('Opções aviso:', e.message);
      }

      let projetoFinal = '';
      if (projeto) {
        const r = resolverEntidade(projeto, opcoes.projetos || []);
        if (r.encontrado) {
          projetoFinal = r.valor;
        } else {
          projetoFinal = projeto;
          avisos.push(`O projeto "${projeto}" não consta no cadastro; será gravado como informado.`);
        }
      } else {
        avisos.push('Projeto não informado — a atividade ficará fora dos relatórios por projeto.');
      }

      let assuntoFinal = '';
      if (assunto) {
        const r = resolverEntidade(assunto, opcoes.assuntosInternos || []);
        assuntoFinal = r.encontrado ? r.valor : assunto;
        if (!r.encontrado) avisos.push(`O assunto "${assunto}" não consta no cadastro; será gravado como informado.`);
      } else {
        avisos.push('Assunto interno não informado — o resumo semanal agrupa por assunto.');
      }

      const tempoFormatado = segundosParaTempo(segundos);

      return resultadoProposta({
        tipo: 'registrar_atividade',
        descricao: `Registrar "${titulo}" em ${dataFinal} (${tempoFormatado})${projetoFinal ? ` — ${projetoFinal}` : ''}.`,
        // Escrita em dado historico: impacto alto, porque alimenta todo
        // relatorio posterior.
        impacto: 'alto',
        dados: {
          titulo: titulo.trim(),
          atividade: descricao.trim(),
          data: dataFinal,
          semana: calcularSemanaDeData(dataFinal),
          projeto: projetoFinal,
          assuntoInterno: assuntoFinal,
          tempo: tempoFormatado,
          avisos
        }
      });
    }
  });

  return [proporRegistrarAtividade];
}

// Exportado para teste direto: a conversao de tempo e a parte mais sujeita a
// regressao silenciosa deste arquivo.
export { interpretarTempo };
