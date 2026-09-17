function obterUserId(req) {
  return req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
}

export function makeReuniaoController({ processarReuniao }) {
  return {
    async processar(req, res) {
      const { nome_reuniao, data_reuniao, transcricao } = req.body;

      if (!transcricao) {
        return res.status(400).json({ error: 'Nenhuma transcrição enviada.' });
      }

      try {
        const resultado = await processarReuniao({
          userId: obterUserId(req),
          nome_reuniao,
          data_reuniao,
          transcricao
        });
        return res.json(resultado);
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao processar reunião.' });
      }
    }
  };
}
