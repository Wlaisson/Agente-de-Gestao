export function makeOpcoesController({ obterOpcoes, atualizarOpcoes }) {
  return {
    async obter(req, res) {
      try {
        const opcoes = await obterOpcoes();
        res.json({ status: 'success', data: opcoes });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    },

    async atualizar(req, res) {
      try {
        const data = await atualizarOpcoes(req.body);
        return res.json({ status: 'success', data });
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
    }
  };
}
