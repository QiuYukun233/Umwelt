import express, { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';
import { orderRoutes } from './routes/orderRoutes.js';

export const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/orders', orderRoutes);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.name,
      message: error.message
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'Unexpected server error'
  });
});
