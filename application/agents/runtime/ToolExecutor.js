import { resultadoErro } from './definirFerramenta.js';

// Executa as ferramentas pedidas pelo modelo.
//
// O ponto de controle do sistema: e aqui que o contexto do servidor (userId
// autenticado) entra na chamada, que a auditoria e escrita e que um erro de
// ferramenta vira dado em vez de excecao.
//
// Por que erro nao propaga: se uma ferramenta lanca, o loop do agente morre
// e o usuario recebe 500. Devolvendo o erro COMO RESULTADO, o modelo pode
// se recuperar na proxima iteracao - tentar outro filtro, ou explicar ao
// usuario o que faltou. Falha de ferramenta e informacao, nao acidente.
export function createToolExecutor({ tracer, auditoriaRepository = null }) {
  async function executar({ ferramenta, argumentos, contexto, contextId, parentSpanId }) {
    const span = tracer.iniciarSpan({
      contextId,
      parentId: parentSpanId,
      nome: ferramenta.nome,
      tipo: 'ferramenta',
      // Argumentos entram no trace; `contexto` nao - carrega identidade e
      // nao deve ser espalhado pelo buffer de traces.
      atributos: { argumentos, escrita: ferramenta.escrita }
    });

    try {
      const resultado = await ferramenta.executar(argumentos || {}, contexto);

      span.finalizar({
        status: resultado?.ok === false ? 'erro-de-dominio' : 'ok',
        atributos: {
          proposta: !!resultado?.proposta,
          // O resultado inteiro pode ser grande (dezenas de atividades); so
          // o tamanho interessa para diagnostico.
          tamanhoResultado: JSON.stringify(resultado ?? null).length
        }
      });

      // Auditoria cobre proposta de escrita tambem: saber o que o agente
      // SUGERIU e tao importante quanto o que foi executado - e o registro
      // de uma sugestao recusada.
      if (ferramenta.escrita && auditoriaRepository) {
        await auditoriaRepository.registrar({
          userId: contexto.userId,
          contextId,
          acao: `proposta:${ferramenta.nome}`,
          detalhes: { argumentos, proposta: resultado },
          executado: false
        }).catch(e => console.log('Auditoria aviso:', e.message));
      }

      return resultado;
    } catch (e) {
      span.finalizar({ status: 'erro', erro: e });
      console.error(`[ferramenta:${ferramenta.nome}]`, e);
      return resultadoErro(
        `Falha ao executar "${ferramenta.nome}": ${e.message}`,
        { sugestao: 'Informe ao usuário que a consulta falhou. Não invente o resultado.' }
      );
    }
  }

  return { executar };
}
