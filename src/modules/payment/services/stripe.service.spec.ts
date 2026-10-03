import { StripeService } from './stripe.service';

describe('StripeService read-only status methods', () => {
  let service: StripeService;

  beforeEach(() => {
    service = new StripeService();
  });

  it('returns payment intent status without charging', async () => {
    (service as unknown as { stripe: unknown }).stripe = {
      paymentIntents: { retrieve: jest.fn().mockResolvedValue({ status: 'succeeded' }) },
      refunds: { retrieve: jest.fn() },
    };
    await expect(service.getPaymentIntentStatus('pi_123')).resolves.toEqual({ status: 'succeeded' });
  });

  it('returns refund status without creating a refund', async () => {
    (service as unknown as { stripe: unknown }).stripe = {
      paymentIntents: { retrieve: jest.fn() },
      refunds: { retrieve: jest.fn().mockResolvedValue({ status: 'succeeded' }) },
    };
    await expect(service.getRefundStatus('re_123')).resolves.toEqual({ status: 'succeeded' });
  });

  it('maps provider failure to unknown instead of throwing raw error', async () => {
    (service as unknown as { stripe: unknown }).stripe = {
      paymentIntents: {
        retrieve: jest.fn().mockRejectedValue(new Error('connection reset')),
      },
      refunds: { retrieve: jest.fn() },
    };
    await expect(service.getPaymentIntentStatus('pi_bad')).resolves.toEqual({ status: 'unknown' });
  });
});
