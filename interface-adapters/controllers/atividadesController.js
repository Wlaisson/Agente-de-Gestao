function obterUserId(req, fromQueryOrBody) {
  return req.headers['x-user-id'] || req.headers['user-id'] || fromQueryOrBody;
}

export function makeAtividadesController({ listarAtividades, criarAtividade, atualizarAtividade, excluirAtividade }) {
  return {
    async listar(req, res) {
      const userId = obterUserId(req, req.query.userId);
      try {
        const data = await listarAtividades({
          userId,
          todos: req.query.todos,
          semana: req.query.semana,
          start: req.query.start,
          end: req.query.end
        });
        return res.json({ status: 'success', data });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao listar atividades.' });
      }
    },

    async criar(req, res) {
      const userId = obterUserId(req, req.body.userId);
      try {
        const registro = await criarAtividade({ userId, body: req.body });
        return res.json({ status: 'success', data: registro });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao registrar atividade.' });
      }
    },

    async atualizar(req, res) {
      const userId = obterUserId(req, req.body.userId);
      const { id } = req.params;
      try {
        await atualizarAtividade({ id, userId, body: req.body });
        return res.json({ status: 'success' });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao atualizar atividade.' });
      }
    },

    async excluir(req, res) {
      const userId = obterUserId(req, req.query.userId);
      const { id } = req.params;
      try {
        await excluirAtividade({ id, userId });
        return res.json({ status: 'success' });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao excluir atividade.' });
      }
    }
  };
}
