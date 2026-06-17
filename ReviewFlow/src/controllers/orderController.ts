import { Request, Response } from 'express';
import { confirmOrder } from '../services/orderService.js';

export async function confirmOrderController(req: Request, res: Response) {
  const orderId = Number(req.params.orderId);
  const actorId = Number(req.body.actorId);
  const forcePaymentFailure = Boolean(req.body.forcePaymentFailure);

  const result = await confirmOrder({
    orderId,
    actorId,
    forcePaymentFailure
  });

  res.status(200).json({
    orderId: result.order.id,
    status: result.order.status,
    paymentLogId: result.paymentLog.id
  });
}
