import { Router } from 'express';

export function createKanbanRoutes({ kanbanController }) {
  const router = Router();
  router.get('/api/kanban', kanbanController.listar);
  router.post('/api/kanban', kanbanController.processarAcao);
  return router;
}
