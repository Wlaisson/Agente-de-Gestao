function obterUserId(req) {
  return req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
}

export function makeRelatoriosController({ gerarRelatorioSemanal, openAIGateway }) {
  async function gerar(req, res, modo, mensagemErroGenerica) {
    const { semana } = req.body;
    if (!semana) {
      return res.status(400).json({ error: 'Parâmetro "semana" é obrigatório.' });
    }

    const userId = obterUserId(req);
    let openAiConfig;
    try {
      openAiConfig = await openAIGateway.obterCliente(userId);
    } catch (errSetup) {
      return res.status(400).json({ error: errSetup.message });
    }

    try {
      const resultado = await gerarRelatorioSemanal({ userId, semana, modo, openAiConfig });
      return res.json(resultado);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: mensagemErroGenerica });
    }
  }

  return {
    gerarConsolidado: (req, res) => gerar(req, res, 'consolidado', 'Erro ao gerar relatório semanal.'),
    gerarReporter: (req, res) => gerar(req, res, 'reporter', 'Erro ao gerar relatório do Agente Repórter.')
  };
}
