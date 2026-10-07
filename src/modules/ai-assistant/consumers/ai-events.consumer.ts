import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { ConfigService } from '@nestjs/config';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { RedisService } from 'src/common/redis/redis.service';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AI_COST_LIMITS } from '../services/ai-quota.service';
import { DeleteAiConversationUseCase } from '../use-cases/delete-ai-conversation.use-case';

export interface AiMessageAnsweredPayload {
    conversationId: string;
    messageId: string;
    patientId?: string;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
    specialtySuggestion: any | null;
}

const CONSUMER_NAME = 'ai-message-answered-analytics';

@Injectable()
export class AiEventsConsumer {
    private readonly logger = new Logger(AiEventsConsumer.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(ProcessedEventEntity)
        private readonly processedEvents: Repository<ProcessedEventEntity>,
        private readonly redisService: RedisService,
        private readonly amqpConnection: AmqpConnection,
        private readonly deleteConversationUseCase: DeleteAiConversationUseCase,
        private readonly configService: ConfigService,
    ) { }

    @RabbitSubscribe({
        exchange: 'ai_exchange',
        routingKey: 'AI_MESSAGE_ANSWERED',
        queue: 'ai_analytics_queue',
        queueOptions: {
            arguments: {
                'x-dead-letter-exchange': 'ai_exchange.dlx',
                'x-dead-letter-routing-key': 'AI_MESSAGE_ANSWERED.dead',
            },
        },
    })
    public async handleAiMessageAnswered(
        msg: AiMessageAnsweredPayload,
        amqpMsg: ConsumeMessage,
    ) {
        const rawEventId = amqpMsg.properties.headers?.['x-event-id'] as string | undefined;
        const eventKey = rawEventId ? `${rawEventId}:${CONSUMER_NAME}` : undefined;

        this.logger.log(
            `[RabbitMQ Consumer] Received 'AI_MESSAGE_ANSWERED' event for message: ${msg?.messageId} (conversation: ${msg?.conversationId})`,
        );

        if (!msg || !msg.messageId || !msg.conversationId) {
            this.logger.warn(`AI Message Event payload invalid. Sending to DLQ.`);
            return new Nack(false);
        }

        try {
            await this.dataSource.transaction(async (manager) => {
                if (eventKey) {
                    const alreadyProcessed = await manager.findOne(ProcessedEventEntity, {
                        where: { eventId: eventKey },
                    });

                    if (alreadyProcessed) {
                        this.logger.warn(`[Idempotency] Event ${eventKey} already processed — skipping.`);
                        return;
                    }
                }

                const prices = this.getPrices();
                const inputCost = (msg.tokensIn / 1_000_000) * prices.input;
                const outputCost = (msg.tokensOut / 1_000_000) * prices.output;
                const totalCostUsd = inputCost + outputCost;

                this.logger.log(
                    `[AI Cost Calculated] Conversation ${msg.conversationId} cost: $${totalCostUsd.toFixed(6)}`,
                );

                await this.trackMonthlySpendAndAlert(totalCostUsd, msg.patientId);

                if (eventKey) {
                    await manager.insert(ProcessedEventEntity, {
                        eventId: eventKey,
                        eventType: 'AI_MESSAGE_ANSWERED',
                    });
                }
            });

            return;
        } catch (error: any) {
            if (error.code === '23505') {
                this.logger.warn(`[Idempotency] Event ${eventKey} recorded concurrently — skipping.`);
                return;
            }

            this.logger.error(
                `Failed to process AI analytics for message ${msg.messageId}: ${error.message}`,
                error.stack,
            );

            return new Nack(false);
        }
    }


    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'PATIENT_ACCOUNT_DELETED',
        queue: 'ai_patient_deletion_queue',
    })
    public async handlePatientAccountDeleted(payload: { patientId: string }) {
        if (!payload?.patientId) return;
        this.logger.log(`[Account Deletion] Purging all AI conversations for deleted patient ${payload.patientId}`);

        const conversations = await this.dataSource.query(
            `SELECT id FROM ai_conversations WHERE patient_id = $1`,
            [payload.patientId],
        );

        for (const conv of conversations) {
            await this.deleteConversationUseCase.execute(conv.id, {
                userId: payload.patientId,
                role: 'PATIENT',
            });
        }
    }

    @RabbitSubscribe({
        exchange: 'ai_exchange.dlx',
        routingKey: 'AI_MESSAGE_ANSWERED.dead',
        queue: 'ai_analytics_queue.dlq',
    })
    public async handleDeadLetter(msg: any, amqpMsg: ConsumeMessage) {
        const deathHeader = amqpMsg.properties.headers?.['x-death'];
        this.logger.error(`[DLQ Alert] AI Analytics landed in DLQ! Payload:`, msg);
        this.logger.error(`[DLQ Details] Death info:`, deathHeader);
    }

    private getPrices() {
        return {
            input: this.configService.get<number>('AI_PRICE_PER_1M_INPUT', 0.15),
            output: this.configService.get<number>('AI_PRICE_PER_1M_OUTPUT', 0.60),
        };
    }

    private async trackMonthlySpendAndAlert(costUsd: number, patientId?: string): Promise<void> {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const monthlySpendKey = `ai_spend:monthly:${currentMonth}`;
        const ttlSeconds = 31 * 24 * 3600;

        const totalSystemSpend = await this.redisService.incrByFloat(monthlySpendKey, costUsd);
        await this.redisService.expire(monthlySpendKey, ttlSeconds);

        if (patientId) {
            const patientSpendKey = `ai_spend:patient:${patientId}:${currentMonth}`;
            await this.redisService.incrByFloat(patientSpendKey, costUsd);
            await this.redisService.expire(patientSpendKey, ttlSeconds);
        }

        const spendRatio = totalSystemSpend / AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD;

        for (const threshold of AI_COST_LIMITS.ALERT_THRESHOLDS) {
            if (spendRatio >= threshold) {
                const alertKey = `ai_spend_alert_sent:${currentMonth}:${threshold * 100}`;
                const alreadyAlerted = await this.redisService.get<string>(alertKey);

                if (!alreadyAlerted) {
                    await this.redisService.set(alertKey, '1', ttlSeconds);

                    this.logger.warn(
                        `🚨 [AI Spend Alert] Monthly spend reached ${(threshold * 100)}% ($${totalSystemSpend.toFixed(2)} / $${AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD})`,
                    );

                    await this.amqpConnection.publish('ai_exchange', 'AI_SPEND_THRESHOLD_REACHED', {
                        thresholdPercentage: threshold * 100,
                        currentSpendUsd: totalSystemSpend,
                        monthlyCeilingUsd: AI_COST_LIMITS.MONTHLY_SPEND_CEILING_USD,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }
    }
}