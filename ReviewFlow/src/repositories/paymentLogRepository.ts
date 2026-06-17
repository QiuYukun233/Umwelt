import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { PaymentStatus } from '../domain/status.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export function insertAuthorizedPaymentLog(
  orderId: number,
  amountCents: number,
  client: PrismaExecutor = prisma
) {
  return client.paymentLog.create({
    data: {
      orderId,
      provider: 'mock-pay',
      status: PaymentStatus.AUTHORIZED,
      amountCents
    }
  });
}

export function insertFailedPaymentLog(
  orderId: number,
  amountCents: number,
  failureReason: string,
  client: PrismaExecutor = prisma
) {
  return client.paymentLog.create({
    data: {
      orderId,
      provider: 'mock-pay',
      status: PaymentStatus.FAILED,
      amountCents,
      failureReason
    }
  });
}
