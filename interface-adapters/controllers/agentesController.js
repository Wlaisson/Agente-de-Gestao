import { mensagemUsuario, extrairTexto, extrairDados } from '../../domain/a2a/Message.js';
import { ErroA2A } from '../../domain/a2a/erros.js';
import { PROMPT_VOCABULARIO_WHISPER } from '../../shared/vocabularioTranscricao.js';

// Mesma extracao de identidade dos demais controllers do projeto.
function obterUserId(req) {
  return req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId || req.query?.userId || null;
}

// Fachada REST para a interface do produto.
//
// Convive com o endpoint JSON-RPC (/a2a) de proposito: aquele serve a
// fronteira A2A, com o formato do protocolo; este serve a nossa UI, com um
// contrato mais direto ({ texto, propostas, ... }) e no mesmo estilo dos
// outros endpoints do app. Os dois entram no MESMO TaskManager - nenhuma
// regra de negocio ou de seguranca e duplicada entre eles.
export function makeAgentesController({ taskManager, agentRegistry, openAIGateway, tracer }) {
  function respostaDeTarefa(tarefa) {
    const mensagem = tarefa.status.message;
    const dados = extrairDados(mensagem) || {};
    return {
      status: 'success',
      taskId: tarefa.id,
      contextId: tarefa.contextId,
      estado: tarefa.status.state,
      texto: extrairTexto(mensagem),
      // A UI usa isto para renderizar os botoes de confirmar/descartar.
      aguardandoConfirmacao: tarefa.status.state === 'input-required',
      propostas: tarefa.metadata?.propostasPendentes || [],
      dados
    };
  }

  function tratarErro(res, err, mensagemGenerica) {
    if (err instanceof ErroA2A) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: mensagemGenerica });
  }

  return {
    async conversar(req, res) {
      const userId = obterUserId(req);
      if (!userId) return res.status(401).json({ error: 'Usuário não autenticado.' });

      const { texto, taskId = null, contextId = null, agentId = 'orquestrador', dados = null } = req.body || {};
      if ((!texto || !texto.trim()) && !dados) {
        return res.status(400).json({ error: 'Envie "texto" ou "dados".' });
      }

      // A config da OpenAI e resolvida antes de abrir a tarefa: sem chave, a
      // falha e de setup e o usuario precisa de uma mensagem acionavel, nao
      // de uma tarefa marcada como "failed".
      let openAiConfig;
      try {
        openAiConfig = await openAIGateway.obterCliente(userId);
      } catch (errSetup) {
        return res.status(400).json({ error: errSetup.message });
      }

      const mensagem = mensagemUsuario(texto || '', { taskId, contextId });
      if (dados) mensagem.parts.push({ kind: 'data', data: dados });

      try {
        const tarefa = await taskManager.enviarMensagem({
          agentId,
          mensagem,
          taskId,
          contextId,
          userId,
          openAiConfig
        });
        return res.json(respostaDeTarefa(tarefa));
      } catch (err) {
        return tratarErro(res, err, 'Erro ao conversar com o agente.');
      }
    },

    // Entrada por voz: transcreve o audio e entra no MESMO fluxo de texto.
    //
    // Duas regras de seguranca que nao mudam:
    //   1. O texto transcrito SEMPRE volta na resposta (campo textoTranscrito)
    //      para que a UI o mostre como bolha do usuario ANTES da resposta do
    //      agente. Audio -> acao sem texto visivel e como se registra a
    //      atividade errada sem ninguem perceber.
    //   2. Voz nunca reduz o nivel de confirmacao: proposta de escrita vinda
    //      de audio continua exigindo o cartao de confirmacao visual.
    async conversarAudio(req, res) {
      const userId = obterUserId(req);
      if (!userId) return res.status(401).json({ error: 'Usuário não autenticado.' });

      if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de áudio no campo "audio".' });

      let openAiConfig;
      try {
        openAiConfig = await openAIGateway.obterCliente(userId);
      } catch (errSetup) {
        return res.status(400).json({ error: errSetup.message });
      }

      // Transcrever com vocabulario de dominio obrigatorio: sem ele, nomes
      // proprios como "Prosis", "Imdepa" e "Tracbel" viram lixo e a
      // resolucao de projeto quebra.
      let textoTranscrito;
      try {
        const transcricao = await openAIGateway.transcreverAudio({
          openai: openAiConfig.openai,
          buffer: req.file.buffer,
          filename: req.file.originalname || 'audio.webm',
          mimetype: req.file.mimetype || 'audio/webm',
          prompt: PROMPT_VOCABULARIO_WHISPER
        });
        textoTranscrito = (transcricao?.text || '').trim();
      } catch (errTranscricao) {
        return res.status(500).json({ error: `Falha na transcrição: ${errTranscricao.message}` });
      }

      if (!textoTranscrito) {
        return res.status(400).json({ error: 'Não foi possível identificar fala no áudio.' });
      }

      const { taskId = null, contextId = null, agentId = 'orquestrador' } = req.body || {};
      const mensagem = mensagemUsuario(textoTranscrito, { taskId, contextId });

      try {
        const tarefa = await taskManager.enviarMensagem({
          agentId,
          mensagem,
          taskId,
          contextId,
          userId,
          openAiConfig
        });
        return res.json({ ...respostaDeTarefa(tarefa), textoTranscrito });
      } catch (err) {
        return tratarErro(res, err, 'Erro ao conversar com o agente.');
      }
    },

    // Confirmacao/recusa vinda de botao. Passa pelo MESMO caminho de uma
    // mensagem de texto - a diferenca e so a DataPart estruturada, que
    // `interpretarConfirmacao` reconhece sem ambiguidade.
    async confirmar(req, res) {
      const userId = obterUserId(req);
      if (!userId) return res.status(401).json({ error: 'Usuário não autenticado.' });

      const { taskId, confirmar = true } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'O campo "taskId" é obrigatório.' });

      let openAiConfig;
      try {
        openAiConfig = await openAIGateway.obterCliente(userId);
      } catch (errSetup) {
        return res.status(400).json({ error: errSetup.message });
      }

      const mensagem = mensagemUsuario(confirmar ? 'Confirmo.' : 'Não, cancele.', { taskId });
      mensagem.parts.push({ kind: 'data', data: { confirmar: !!confirmar } });

      try {
        const tarefa = await taskManager.enviarMensagem({
          agentId: req.body.agentId || 'orquestrador',
          mensagem,
          taskId,
          userId,
          openAiConfig
        });
        return res.json(respostaDeTarefa(tarefa));
      } catch (err) {
        return tratarErro(res, err, 'Erro ao confirmar a ação.');
      }
    },

    async obterTarefa(req, res) {
      const userId = obterUserId(req);
      if (!userId) return res.status(401).json({ error: 'Usuário não autenticado.' });
      try {
        const tarefa = await taskManager.obterTarefa({ taskId: req.params.id, userId });
        return res.json(respostaDeTarefa(tarefa));
      } catch (err) {
        return tratarErro(res, err, 'Erro ao consultar a tarefa.');
      }
    },

    async cancelarTarefa(req, res) {
      const userId = obterUserId(req);
      if (!userId) return res.status(401).json({ error: 'Usuário não autenticado.' });
      try {
        const tarefa = await taskManager.cancelarTarefa({ taskId: req.params.id, userId });
        return res.json(respostaDeTarefa(tarefa));
      } catch (err) {
        return tratarErro(res, err, 'Erro ao cancelar a tarefa.');
      }
    },

    listarAgentes(req, res) {
      res.json({ status: 'success', agentes: agentRegistry.listarCards() });
    },

    // Introspeccao do raciocinio: qual agente foi acionado, quais
    // ferramentas rodaram e quanto cada passo demorou. E o que permite
    // responder "por que ele disse isso?" sem adivinhar.
    obterTrace(req, res) {
      const { contextId } = req.params;
      res.json({ status: 'success', contextId, spans: tracer.obterArvore(contextId) });
    }
  };
}
