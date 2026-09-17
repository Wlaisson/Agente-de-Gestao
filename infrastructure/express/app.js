import express from 'express';
import cors from 'cors';
import path from 'path';
import { createRoutes } from '../../interface-adapters/routes/index.js';

// Bootstrap do Express, portado verbatim de server.js (mesma ordem de
// middlewares: cors -> json -> static -> rotas).
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static('.'));

  // Serve a pagina de admin diretamente (nao e um endpoint de API de
  // nenhum dominio - so mantido aqui, junto do resto do bootstrap estatico).
  app.get('/usuarios', (req, res) => {
    res.sendFile(path.resolve('usuarios.html'));
  });

  app.use(createRoutes());
  return app;
}
