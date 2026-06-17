import { PaymentError } from '../errors.js';

type AuthorizePaymentInput = {
  orderId: number;
  amountCents: number;
  forcePaymentFailure?: boolean;
};

export async function authorizePayment(input: AuthorizePaymentInput) {
  if (input.forcePaymentFailure) {
    throw new PaymentError('Payment provider rejected the authorization');
  }

  return {
    provider: 'mock-pay',
    authorizationId: `auth_${input.orderId}_${Date.now()}`,
    amountCents: input.amountCents
  };
}
