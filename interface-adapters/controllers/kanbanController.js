// Controller fino: o dispatcher de acoes continua aqui (mesma forma da rota
// original), so delegando cada branch para seu use-case.
export function makeKanbanController({
  listarCards,
  adicionarCard,
  atualizarStatusCard,
  excluirCard,
  concluirCard,
  editarCard
}) {
  return {
    async listar(req, res) {
      const data = await listarCards();
      res.json({ status: 'success', data });
    },

    async processarAcao(req, res) {
      const { action } = req.body;

      if (action === 'add_kanban') {
        const novoCard = await adicionarCard(req.body);
        return res.json({ status: 'success', id: novoCard.id, data: novoCard });
      }

      if (action === 'update_kanban_status') {
        await atualizarStatusCard({ id: req.body.id, status: req.body.status });
        return res.json({ status: 'success' });
      }

      if (action === 'delete_kanban') {
        await excluirCard(req.body.id);
        return res.json({ status: 'success' });
      }

      if (action === 'complete_kanban') {
        await concluirCard({
          id: req.body.id,
          tempo: req.body.tempo,
          classNivel1: req.body.classNivel1,
          classNivel2: req.body.classNivel2
        });
        return res.json({ status: 'success' });
      }

      if (action === 'edit_kanban' || action === 'update_kanban') {
        const card = await editarCard(req.body);
        return res.json({ status: 'success', data: card });
      }

      res.status(400).json({ error: 'Ação inválida' });
    }
  };
}
