import { Router } from 'express';

export function createAtividadesRoutes({ atividadesController }) {
  const router = Router();
  router.get('/api/atividades', atividadesController.listar);
  router.post('/api/atividades', atividadesController.criar);
  router.put('/api/atividades/:id', atividadesController.atualizar);
  router.delete('/api/atividades/:id', atividadesController.excluir);
  return router;
}
