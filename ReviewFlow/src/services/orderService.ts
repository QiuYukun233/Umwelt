import { prisma } from '../db/prisma.js';
import { OrderStatus } from '../domain/status.js';
import { ConflictError, NotFoundError, PaymentError, ValidationError } from '../errors.js';
import { authorizePayment } from '../external/paymentGateway.js';
import {
  findOrderForConfirmation,
  markOrderConfirmed
} from '../repositories/orderRepository.js';
import {
  decrementInventory,
  findInventoryBySkus
} from '../repositories/inventoryRepository.js';
import {
  insertAuthorizedPaymentLog,
  insertFailedPaymentLog
} from '../repositories/paymentLogRepository.js';

export type ConfirmOrderInput = {
  orderId: number;
  actorId: number;
  forcePaymentFailure?: boolean;
};

export async function confirmOrder(input: ConfirmOrderInput) {
  if (!Number.isInteger(input.orderId) || input.orderId <= 0) {
    throw new ValidationError('orderId must be a positive integer');
  }

  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new ValidationError('actorId must be a positive integer');
  }

  return prisma.$transaction(async (tx) => {
    const order = await findOrderForConfirmation(input.orderId, tx);

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (order.customerId !== input.actorId) {
      throw new ValidationError('Actor cannot confirm this order');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictError('Only pending orders can be confirmed');
    }

    const skus = order.items.map((item) => item.sku);
    const inventoryRows = await findInventoryBySkus(skus, tx);

    for (const item of order.items) {
      const inventory = inventoryRows.find((row) => row.sku === item.sku);

      if (!inventory) {
        throw new ConflictError(`Inventory is missing for ${item.sku}`);
      }

      if (inventory.quantity < item.quantity) {
        throw new ConflictError(`Insufficient inventory for ${item.sku}`);
      }
    }

    try {
      await authorizePayment({
        orderId: order.id,
        amountCents: order.totalCents,
        forcePaymentFailure: input.forcePaymentFailure
      });
    } catch (error) {
      await insertFailedPaymentLog(
        order.id,
        order.totalCents,
        error instanceof Error ? error.message : 'Unknown payment failure',
        tx
      );
      throw new PaymentError('Order payment authorization failed');
    }

    for (const item of order.items) {
      await decrementInventory(item.sku, item.quantity, tx);
    }

    const paymentLog = await insertAuthorizedPaymentLog(order.id, order.totalCents, tx);
    const confirmedOrder = await markOrderConfirmed(order.id, tx);

    return {
      order: confirmedOrder,
      paymentLog
    };
  });
}
