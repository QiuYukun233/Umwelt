export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED'
} as const;

export const PaymentStatus = {
  AUTHORIZED: 'AUTHORIZED',
  FAILED: 'FAILED'
} as const;
