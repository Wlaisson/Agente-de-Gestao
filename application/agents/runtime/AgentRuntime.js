import { ferramentaParaSchemaOpenAI } from './definirFerramenta.js';

// O laco de execucao de um agente: modelo -> ferramentas -> modelo, ate ele
// parar de pedir ferramenta ou o teto de iteracoes ser atingido.
//
// Por que um teto: um agente que nao acha o que procura tende a reformular a
// mesma busca indefinidamente. Sem limite isso e uma conta da OpenAI aberta
// e um request pendurado. Ao estourar, devolvemos o que ja foi coletado e
// dizemos a verdade ao usuario, em vez de fingir uma resposta.
const MAX_ITERACOES_PADRAO = 8;

export function createAgentRuntime({ openAIGateway, toolExecutor, tracer }) {
  async function executar({
    agentId,
    systemPrompt,
    mensagens,
    ferramentas = [],
    contexto,
    contextId,
    parentSpanId = null,
    openAiConfig,
    maxIteracoes = MAX_ITERACOES_PADRAO,
    maxTokens = 3000,
    temperature = 0.1
  }) {
    const span = tracer.iniciarSpan({
      contextId,
      parentId: parentSpanId,
      nome: agentId,
      tipo: 'agente',
      atributos: { ferramentasDisponiveis: ferramentas.map(f => f.nome) }
    });

    const porNome = new Map(ferramentas.map(f => [f.nome, f]));
    const schemas = ferramentas.map(ferramentaParaSchemaOpenAI);

    const historico = [
      { role: 'system', content: systemPrompt },
      ...mensagens
    ];

    // Propostas de escrita acumuladas: sobem ate o TaskManager, que coloca a
    // tarefa em `input-required`.
    const propostas = [];
    const ferramentasChamadas = [];
    let iteracao = 0;

    try {
      while (iteracao < maxIteracoes) {
        iteracao++;

        const params = {
          messages: historico,
          temperature,
          max_tokens: maxTokens
        };
        // `tool_choice: 'auto'` so e valido junto de `tools`. Na ultima
        // iteracao as ferramentas sao retiradas de proposito: forca o modelo
        // a redigir a resposta final em vez de pedir mais uma consulta que
        // nao teria como ser respondida.
        const ultimaIteracao = iteracao === maxIteracoes;
        if (schemas.length > 0 && !ultimaIteracao) {
          params.tools = schemas;
          params.tool_choice = 'auto';
        }

        const spanModelo = tracer.iniciarSpan({
          contextId,
          parentId: span.id,
          nome: `modelo:iteracao-${iteracao}`,
          tipo: 'llm',
          atributos: { mensagensNoHistorico: historico.length }
        });

        let resposta;
        try {
          resposta = await openAIGateway.chamarModelo(params, openAiConfig.openai, openAiConfig.modelos);
          spanModelo.finalizar({ status: 'ok' });
        } catch (e) {
          spanModelo.finalizar({ status: 'erro', erro: e });
          throw e;
        }

        const escolha = resposta?.choices?.[0];
        const mensagem = escolha?.message;
        if (!mensagem) throw new Error('Resposta do modelo sem mensagem.');

        const chamadas = mensagem.tool_calls || [];

        if (chamadas.length === 0) {
          const texto = (mensagem.content || '').trim();
          span.finalizar({ status: 'ok', atributos: { iteracoes: iteracao, ferramentasChamadas } });
          return {
            texto,
            propostas,
            ferramentasChamadas,
            iteracoes: iteracao,
            truncado: false
          };
        }

        // A mensagem do assistente com os tool_calls precisa entrar no
        // historico ANTES dos resultados: a API exige que cada `tool` tenha
        // um `tool_call_id` que exista na mensagem imediatamente anterior.
        historico.push(mensagem);

        // O modelo pode pedir varias ferramentas de uma vez (ex.: somar
        // tempo de dois projetos). Executar em paralelo economiza uma
        // ida-e-volta por ferramenta; sao leituras independentes.
        const resultados = await Promise.all(chamadas.map(async (chamada) => {
          const nome = chamada.function?.name;
          const ferramenta = porNome.get(nome);

          if (!ferramenta) {
            return {
              chamada,
              resultado: { ok: false, erro: `Ferramenta desconhecida: ${nome}` }
            };
          }

          let argumentos = {};
          try {
            argumentos = chamada.function.arguments ? JSON.parse(chamada.function.arguments) : {};
          } catch (e) {
            // JSON malformado do modelo e recuperavel: devolver o erro deixa
            // ele reemitir a chamada na proxima iteracao.
            return {
              chamada,
              resultado: { ok: false, erro: `Argumentos em JSON inválido: ${e.message}` }
            };
          }

          const resultado = await toolExecutor.executar({
            ferramenta,
            argumentos,
            contexto,
            contextId,
            parentSpanId: span.id
          });

          return { chamada, resultado, ferramenta };
        }));

        for (const { chamada, resultado, ferramenta } of resultados) {
          ferramentasChamadas.push(chamada.function?.name);

          if (resultado?.proposta) {
            propostas.push({
              ferramenta: ferramenta.nome,
              tipo: resultado.tipo,
              descricao: resultado.descricao,
              dados: resultado.dados,
              impacto: resultado.impacto
            });
          }

          // Propostas criadas por um agente delegado sobem ate aqui: a
          // confirmacao acontece uma unica vez, no nivel da tarefa que fala
          // com o usuario, mesmo que a escrita tenha sido proposta tres
          // niveis abaixo.
          if (Array.isArray(resultado?.propostasDelegadas) && resultado.propostasDelegadas.length > 0) {
            propostas.push(...resultado.propostasDelegadas);
          }

          historico.push({
            role: 'tool',
            tool_call_id: chamada.id,
            content: JSON.stringify(resultado ?? { ok: false, erro: 'sem resultado' })
          });
        }
      }

      // Teto estourado.
      span.finalizar({ status: 'truncado', atributos: { iteracoes: iteracao, ferramentasChamadas } });
      return {
        texto: '',
        propostas,
        ferramentasChamadas,
        iteracoes: iteracao,
        truncado: true
      };
    } catch (e) {
      span.finalizar({ status: 'erro', erro: e });
      throw e;
    }
  }

  return { executar };
}
