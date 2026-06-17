import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export function findInventoryBySkus(skus: string[], client: PrismaExecutor = prisma) {
  return client.inventory.findMany({
    where: {
      sku: { in: skus }
    }
  });
}

export function decrementInventory(sku: string, quantity: number, client: PrismaExecutor = prisma) {
  return client.inventory.update({
    where: { sku },
    data: {
      quantity: {
        decrement: quantity
      }
    }
  });
}
