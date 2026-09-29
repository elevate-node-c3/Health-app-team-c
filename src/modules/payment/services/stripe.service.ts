import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as Stripe from 'stripe';

@Injectable()
export class StripeService {
    private stripe: Stripe;
    private readonly logger = new Logger(StripeService.name);

    constructor() {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
    }

    async chargeCard(params: {
        amount: number;
        currency: string;
        paymentMethodId: string;
        idempotencyKey: string;
    }) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.create(
                {
                    amount: Math.round(params.amount * 100),
                    currency: params.currency.toLowerCase(),
                    payment_method: params.paymentMethodId,
                    confirm: true,
                    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
                    metadata: {
                        idempotencyKey: params.idempotencyKey,
                    },
                },
                { idempotencyKey: params.idempotencyKey },
            );

            return {
                isSuccess: paymentIntent.status === 'succeeded',
                transactionReference: paymentIntent.id,
                failureReason: paymentIntent.last_payment_error?.message || null,
                isTokenInvalid: false,
            };
        } catch (error: any) {
            this.logger.error(`Stripe Error: ${error.type} - ${error.code} - ${error.message}`);

            const isTokenInvalid =
                error.code === 'resource_missing' ||
                error.code === 'payment_method_unactivated' ||
                (error.type === 'StripeInvalidRequestError' && error.param === 'payment_method');

            if (error.type === 'StripeCardError' || error.type === 'StripeInvalidRequestError') {
                return {
                    isSuccess: false,
                    transactionReference: error.payment_intent?.id || null,
                    failureReason: error.message || 'Payment processing failed',
                    isTokenInvalid,
                };
            }

            throw error;
        }
    }

    constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
        try {
            return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
        } catch (err: any) {
            this.logger.error(`Webhook Signature Verification Failed: ${err.message}`);
            throw new BadRequestException(`Webhook Error: ${err.message}`);
        }
    }
}