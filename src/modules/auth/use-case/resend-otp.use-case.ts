import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { ResendOtpDto } from '../dto/resend-otp.dto';
import { generateOtpCode, getOtpExpirationTime } from '../../../common/utils/otp.util';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

@Injectable()
export class ResendOtpUseCase {
    private readonly logger = new Logger(ResendOtpUseCase.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly dataSource: DataSource,
        private readonly outboxProcessorService: OutboxProcessorService,
    ) { }

    async execute(dto: ResendOtpDto) {
        const normalizedEmail = dto.email.toLowerCase().trim();

        const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        if (!user) {
            throw new NotFoundException('User not found with this email.');
        }

        if (user.isVerified) {
            throw new BadRequestException('This account is already verified.');
        }

        const newOtpCode = generateOtpCode(4);
        const newExpiresAt = getOtpExpirationTime(3);

        user.verificationCode = newOtpCode;
        user.code_expires_at = newExpiresAt;
        user.failedAttemptsCount = 0;

        let savedOutboxEventId = '';

        await this.dataSource.transaction(async (manager) => {
            await manager.save(user);

            const outboxEvent = manager.create(OutboxEventEntity, {
                aggregateType: 'User',
                aggregateId: user.id.toString(),
                eventType: 'user.registered',
                exchange: 'auth_exchange',
                payload: {
                    userId: user.id,
                    email: user.email,
                    otpCode: newOtpCode,
                },
                isProcessed: false,
            });

            const savedEvent = await manager.save(outboxEvent);
            savedOutboxEventId = savedEvent.id;
        });

        if (savedOutboxEventId) {
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(savedOutboxEventId).catch((err) => {
                    this.logger.error(`Instant outbox publish failed for resend OTP event ID ${savedOutboxEventId}: ${err.message}`);
                });
            });
        }

        return {
            message: 'A new verification code has been sent to your email.',
        };
    }
}