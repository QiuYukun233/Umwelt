import { PrismaClient } from '@prisma/client';
import { OrderStatus, PaymentStatus } from '../src/domain/status.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.paymentLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.order.deleteMany();

  await prisma.inventory.createMany({
    data: [
      { id: 1, sku: 'sku-widget', quantity: 12 },
      { id: 2, sku: 'sku-cable', quantity: 2 },
      { id: 3, sku: 'sku-scarce', quantity: 0 }
    ]
  });

  await prisma.order.create({
    data: {
      id: 1,
      customerId: 101,
      status: OrderStatus.PENDING,
      totalCents: 4500,
      items: {
        create: [
          { sku: 'sku-widget', quantity: 2, priceCents: 1500 },
          { sku: 'sku-cable', quantity: 1, priceCents: 1500 }
        ]
      }
    }
  });

  await prisma.order.create({
    data: {
      id: 2,
      customerId: 102,
      status: OrderStatus.PENDING,
      totalCents: 3000,
      items: {
        create: [{ sku: 'sku-scarce', quantity: 1, priceCents: 3000 }]
      },
      payments: {
        create: {
          provider: 'mock-pay',
          status: PaymentStatus.FAILED,
          amountCents: 3000,
          failureReason: 'seeded previous failure'
        }
      }
    }
  });

  await prisma.order.create({
    data: {
      id: 3,
      customerId: 103,
      status: OrderStatus.CONFIRMED,
      totalCents: 1500,
      confirmedAt: new Date(),
      items: {
        create: [{ sku: 'sku-widget', quantity: 1, priceCents: 1500 }]
      }
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
