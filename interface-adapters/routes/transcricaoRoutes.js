import { Router } from 'express';
import { upload } from '../../infrastructure/multer/uploadConfig.js';

export function createTranscricaoRoutes({ transcricaoController }) {
  const router = Router();
  router.post('/api/transcrever', upload.single('audio'), transcricaoController.paraAtividade);
  router.post('/api/transcrever-kanban', upload.single('audio'), transcricaoController.paraCard);
  return router;
}
