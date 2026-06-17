import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { OrderStatus } from '../domain/status.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export function findOrderForConfirmation(orderId: number, client: PrismaExecutor = prisma) {
  return client.order.findUnique({
    where: { id: orderId },
    include: { items: true }
  });
}

export function markOrderConfirmed(orderId: number, client: PrismaExecutor = prisma) {
  return client.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.CONFIRMED,
      confirmedAt: new Date()
    }
  });
}
