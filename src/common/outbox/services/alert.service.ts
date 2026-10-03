import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AlertService {
    private readonly logger = new Logger(AlertService.name);
    private readonly slackWebhookUrl = process.env.SLACK_ALERTS_WEBHOOK_URL;

    async notifyPermanentFailure(context: {
        eventId: string;
        eventType: string;
        exchange: string;
        retryCount: number;
        lastError: string;
    }) {
        const message = {
            text:
                `*Outbox event failed permanently*\n` +
                `• Event ID: \`${context.eventId}\`\n` +
                `• Type: \`${context.eventType}\`\n` +
                `• Exchange: \`${context.exchange}\`\n` +
                `• Retries: ${context.retryCount}\n` +
                `• Last error: ${context.lastError}`,
        };


        this.logger.error(`[ALERT] Permanent failure: ${JSON.stringify(context)}`);

        if (!this.slackWebhookUrl) {
            this.logger.warn(
                'SLACK_ALERTS_WEBHOOK_URL not configured — alert logged only, not sent.',
            );
            return;
        }

        try {
            const response = await fetch(this.slackWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
            });

            if (!response.ok) {
                this.logger.error(
                    `Slack alert failed with status ${response.status}: ${await response.text()}`,
                );
            }
        } catch (err: any) {
            this.logger.error(`Failed to send Slack alert: ${err.message}`);
        }
    }

    async notifyReconciliation(context: { paymentTxId: string; holdId: string; reason: string }) {
        this.logger.error(`[ALERT] Reconciliation needed: ${JSON.stringify(context)}`);
        if (!this.slackWebhookUrl) return;
        try {
            await fetch(this.slackWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text:
                        `*Payment reconciliation*\n` +
                        `• Tx: \`${context.paymentTxId}\`\n` +
                        `• Hold: \`${context.holdId}\`\n` +
                        `• Reason: ${context.reason}`,
                }),
            });
        } catch (err: any) {
            this.logger.error(`Failed to send Slack alert: ${err.message}`);
        }
    }

    async notifyRefundFailed(context: { refundId: string; appointmentId: string; reason: string }) {
        this.logger.error(`[ALERT] Refund failed: ${JSON.stringify(context)}`);
        if (!this.slackWebhookUrl) return;
        try {
            await fetch(this.slackWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text:
                        `*Refund failed*\n` +
                        `• Refund: \`${context.refundId}\`\n` +
                        `• Appointment: \`${context.appointmentId}\`\n` +
                        `• Reason: ${context.reason}`,
                }),
            });
        } catch (err: any) {
            this.logger.error(`Failed to send Slack alert: ${err.message}`);
        }
    }
}