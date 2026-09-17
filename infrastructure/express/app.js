import express from 'express';
import cors from 'cors';
import { createRoutes } from '../../interface-adapters/routes/index.js';

// Bootstrap do Express, portado verbatim de server.js (mesma ordem de
// middlewares: cors -> json -> static -> rotas).
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static('.'));
  app.use(createRoutes());
  return app;
}
