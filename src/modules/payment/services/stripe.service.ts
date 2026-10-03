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

    async refundPayment(params: {
        paymentIntentId: string;
        amount: number;
        idempotencyKey: string;
    }): Promise<{
        isSuccess: boolean;
        refundId: string | null;
        status: string;
        failureReason: string | null;
    }> {
        try {
            const refund = await this.stripe.refunds.create(
                {
                    payment_intent: params.paymentIntentId,
                    amount: Math.round(params.amount * 100),
                    metadata: { idempotencyKey: params.idempotencyKey },
                },
                { idempotencyKey: params.idempotencyKey },
            );

            const failed = refund.status === 'failed' || refund.status === 'canceled';
            return {
                isSuccess: !failed,
                refundId: refund.id,
                status: refund.status ?? 'unknown',
                failureReason: failed ? refund.failure_reason ?? 'Refund failed' : null,
            };
        } catch (error: any) {
            this.logger.error(`Stripe Refund Error: ${error.type} - ${error.code} - ${error.message}`);

            if (error.code === 'charge_already_refunded') {
                const existing = await this.stripe.refunds.list({
                    payment_intent: params.paymentIntentId,
                    limit: 1,
                });
                const found = existing.data[0];
                if (found) {
                    return {
                        isSuccess: true,
                        refundId: found.id,
                        status: found.status ?? 'unknown',
                        failureReason: null,
                    };
                }
            }

            if (error.type === 'StripeInvalidRequestError' || error.type === 'StripeCardError') {
                return {
                    isSuccess: false,
                    refundId: null,
                    status: 'failed',
                    failureReason: error.message || 'Refund rejected by payment provider',
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

    async getPaymentIntentStatus(paymentIntentId: string): Promise<{ status: string }> {
        try {
            const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
            return { status: intent.status ?? 'unknown' };
        } catch (err: any) {
            this.logger.error(`Stripe status lookup failed for intent`);
            return { status: 'unknown' };
        }
    }

    async getRefundStatus(refundId: string): Promise<{ status: string }> {
        try {
            const refund = await this.stripe.refunds.retrieve(refundId);
            return { status: refund.status ?? 'unknown' };
        } catch (err: any) {
            this.logger.error(`Stripe refund status lookup failed`);
            return { status: 'unknown' };
        }
    }
}