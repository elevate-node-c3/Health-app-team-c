import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PurgeAiRetentionUseCase } from '../use-cases/purge-ai-retention.use-case';

@Injectable()
export class AiRetentionCron {
    private readonly logger = new Logger(AiRetentionCron.name);

    constructor(private readonly purgeUseCase: PurgeAiRetentionUseCase) { }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleRetentionPurge() {
        this.logger.log('Starting 12-Month AI Data Retention Purge...');
        try {
            const result = await this.purgeUseCase.execute();
            this.logger.log(`Retention Purge completed successfully. Purged messages: ${result.purgedCount}`);
        } catch (error) {
            this.logger.error('Failed to run AI Retention Purge cron job', error);
        }
    }
}