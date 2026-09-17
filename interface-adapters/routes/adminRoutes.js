import { Router } from 'express';

export function createAdminRoutes({ adminController, verificarAdmin }) {
  const router = Router();
  router.post('/api/admin/usuarios', verificarAdmin, adminController.criar);
  router.get('/api/admin/usuarios', verificarAdmin, adminController.listar);
  router.delete('/api/admin/usuarios/:id', verificarAdmin, adminController.excluir);
  return router;
}
