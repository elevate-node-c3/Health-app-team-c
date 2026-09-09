import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { PromoteGuestUseCase } from '../use-case/promote-guest.use-case';

@Injectable()
export class GuestPromotionConsumer {
    private readonly logger = new Logger(GuestPromotionConsumer.name);

    constructor(private readonly promoteGuestUseCase: PromoteGuestUseCase) { }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'guest.promoted',
        queue: 'guest_promotion_queue',
    })
    public async handleGuestPromoted(msg: { guestDeviceId: string; userId: string; bookingIntent?: Record<string, any> | null }) {
        this.logger.log(`[RabbitMQ Consumer] Received 'guest.promoted' device=${msg.guestDeviceId} -> user=${msg.userId}`);

        try {
            const result = await this.promoteGuestUseCase.execute({
                guestDeviceId: msg.guestDeviceId,
                userId: msg.userId,
                bookingIntent: msg.bookingIntent ?? null,
            });

            if (result.skipped === 'GUEST_ALREADY_CLAIMED') {
                this.logger.warn(`Skipped migration for device ${msg.guestDeviceId}: already claimed`);
            } else {
                this.logger.log(`Guest promotion completed: migrated ${result.migratedCount} searches`);
            }
        } catch (error: any) {
            this.logger.error(`Failed to handle guest.promoted for device ${msg.guestDeviceId}: ${error.message}`, error.stack);
        }
    }
}
