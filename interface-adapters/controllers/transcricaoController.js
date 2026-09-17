function obterUserId(req) {
  return req.headers['x-user-id'] || req.headers['user-id'] || req.body?.userId;
}

export function makeTranscricaoController({ transcreverAudioParaAtividade, transcreverAudioParaCard }) {
  return {
    async paraAtividade(req, res) {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }
      try {
        const jsonResult = await transcreverAudioParaAtividade({ userId: obterUserId(req), file: req.file });
        return res.json(jsonResult);
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao processar áudio.' });
      }
    },

    async paraCard(req, res) {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }
      try {
        const tarefas = await transcreverAudioParaCard({ userId: obterUserId(req), file: req.file });
        return res.json({ tarefas });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Erro ao processar áudio para Kanban.' });
      }
    }
  };
}
