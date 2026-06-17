import { Router } from 'express';
import { confirmOrderController } from '../controllers/orderController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const orderRoutes = Router();

orderRoutes.post('/:orderId/confirm', asyncHandler(confirmOrderController));
