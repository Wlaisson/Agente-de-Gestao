import { Router } from 'express';
import { cardParaJson } from '../../domain/a2a/AgentCard.js';
import { upload } from '../../infrastructure/multer/uploadConfig.js';

// Rotas do sistema de agentes.
//
// Duas fronteiras distintas, um so nucleo:
// - /api/agentes/*  -> REST, consumida pela interface deste produto.
// - /a2a            -> JSON-RPC A2A, consumida por clientes de agente
//                      (inclusive de outros times/serviços).
// - /.well-known/agent-card.json -> descoberta, como manda a especificacao.
export function createAgentesRoutes({ agentesController, a2aServer, agentRegistry }) {
  const router = Router();

  router.post('/api/agentes/conversar', agentesController.conversar);
  router.post('/api/agentes/conversar-audio', upload.single('audio'), agentesController.conversarAudio);
  router.post('/api/agentes/confirmar', agentesController.confirmar);
  router.get('/api/agentes/tarefas/:id', agentesController.obterTarefa);
  router.post('/api/agentes/tarefas/:id/cancelar', agentesController.cancelarTarefa);
  router.get('/api/agentes', agentesController.listarAgentes);
  router.get('/api/agentes/historico/:contextId', agentesController.obterHistorico);
  router.get('/api/agentes/trace/:contextId', agentesController.obterTrace);

  // Card do ponto de entrada. Um cliente A2A externo comeca por aqui para
  // descobrir o que este servidor sabe fazer.
  router.get('/.well-known/agent-card.json', (req, res) => {
    const orquestrador = agentRegistry.listarCards().find(c => c.id === 'orquestrador');
    if (!orquestrador) return res.status(404).json({ error: 'Agente de entrada não registrado.' });
    res.json(cardParaJson({
      ...orquestrador,
      url: `${req.protocol}://${req.get('host')}/a2a`
    }));
  });

  // Cards de todos os agentes - util para depuracao e para um orquestrador
  // externo escolher um especialista diretamente.
  router.get('/.well-known/agent-cards.json', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}/a2a`;
    res.json({ agents: agentRegistry.listarCards().map(c => cardParaJson({ ...c, url: base })) });
  });

  router.post('/a2a', async (req, res) => {
    // A identidade continua vindo do header, como no resto do app. Um
    // servico remoto autenticado pelo token compartilhado pode declarar em
    // nome de quem fala via `configuration.userId`.
    const userId = req.headers['x-user-id']
      || req.headers['user-id']
      || req.body?.params?.configuration?.userId
      || null;

    if (!userId) {
      return res.status(401).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32600, message: 'Identificação do usuário ausente.' }
      });
    }

    // Quando A2A_TOKEN_SERVICO esta definido, chamadas que declaram o
    // usuario pelo corpo (em vez do header de sessao) precisam apresentar o
    // segredo. Sem isso, qualquer um que alcance a URL consultaria dados de
    // qualquer usuario informando o id dele.
    const tokenEsperado = process.env.A2A_TOKEN_SERVICO;
    const declaradoPeloCorpo = !req.headers['x-user-id'] && !req.headers['user-id'];
    if (tokenEsperado && declaradoPeloCorpo && req.headers['x-a2a-service-token'] !== tokenEsperado) {
      return res.status(403).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32600, message: 'Token de serviço inválido.' }
      });
    }

    const resposta = await a2aServer.processar(req.body, { userId });
    return res.json(resposta);
  });

  return router;
}
