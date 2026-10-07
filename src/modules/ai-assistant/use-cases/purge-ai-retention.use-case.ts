import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class PurgeAiRetentionUseCase {
    private readonly logger = new Logger(PurgeAiRetentionUseCase.name);

    constructor(private readonly dataSource: DataSource) { }

    public async execute(): Promise<{ purgedCount: number }> {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        return await this.dataSource.transaction(async (manager) => {
            const result = await manager.query(
                `UPDATE ai_messages 
                 SET content = '[PURGED_DUE_TO_RETENTION]', 
                     sanitized_content = '[PURGED_DUE_TO_RETENTION]' 
                 WHERE created_at < $1 AND content != '[PURGED_DUE_TO_RETENTION]'`,
                [twelveMonthsAgo.toISOString()],
            );

            const purgedCount = Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;

            this.logger.log(
                `[Retention Cron] Purged sensitive text content for ${purgedCount} messages older than 12 months.`,
            );

            return { purgedCount };
        });
    }
}