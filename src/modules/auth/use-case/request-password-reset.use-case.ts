import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { UserEntity } from '../entities/user.entity';
import { ForgotPasswordDto, PasswordResetChannel } from '../dto/forgot-password.dto';
import { generateOtpCode, getOtpExpirationTime } from '../../../common/utils/otp.util';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { normalizeEgyptianPhoneNumber } from '../../../common/utils/phone.util';
import { MailService } from '../../../common/mail/mail.service';

@Injectable()
export class RequestPasswordResetUseCase {
  private readonly logger = new Logger(RequestPasswordResetUseCase.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly outboxProcessorService: OutboxProcessorService,
    private readonly mailService: MailService,
  ) {}

  async execute(dto: ForgotPasswordDto) {
    const normalizedEmail = dto.email?.toLowerCase().trim();
    const normalizedPhone = dto.phoneNumber ? normalizeEgyptianPhoneNumber(dto.phoneNumber) : undefined;

    const targetUser = normalizedEmail
      ? await this.userRepository.findOne({ where: { email: normalizedEmail } })
      : normalizedPhone
        ? await this.userRepository.findOne({ where: { phoneNumber: normalizedPhone } })
        : null;

    const genericResponse = {
      statusCode: 200,
      message: 'If an account matches this information, a reset code has been sent to the selected channel.',
      data: {},
    };

    if (!targetUser) {
      return genericResponse;
    }

    const resetCode = generateOtpCode(4);
    const expiresAt = getOtpExpirationTime(3);
    const channel = dto.channel ?? (dto.email ? PasswordResetChannel.EMAIL : PasswordResetChannel.PHONE);
    const notificationTarget = channel === PasswordResetChannel.EMAIL ? targetUser.email : targetUser.phoneNumber;

    let savedOutboxEventId = '';

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, { where: { id: targetUser.id } });
      if (!user) {
        return;
      }

      user.passwordResetCode = resetCode;
      user.passwordResetCodeExpiresAt = expiresAt;
      user.passwordResetCodeUsedAt = null;
      user.passwordResetToken = null;
      user.passwordResetTokenExpiresAt = null;
      user.passwordResetAttemptsCount = 0;
      await manager.save(user);

      const outboxEvent = manager.create(OutboxEventEntity, {
        aggregateType: 'USER',
        eventType: 'user.password_reset_requested',
        payload: {
          userId: user.id,
          channel,
          target: notificationTarget,
          resetCode,
        },
        isProcessed: false,
      });

      const savedEvent = await manager.save(outboxEvent);
      savedOutboxEventId = savedEvent.id;
    });

    if (savedOutboxEventId) {
      setImmediate(() => {
        this.outboxProcessorService.triggerPublish(savedOutboxEventId).catch((err) => {
          this.logger.error(`Instant outbox publish failed for password reset request ID ${savedOutboxEventId}: ${err.message}`);
        });
      });
    }

    if (channel === PasswordResetChannel.EMAIL) {
      try {
        await this.mailService.sendPasswordResetEmail(targetUser.email, resetCode);
      } catch (error) {
        this.logger.error(`Failed to send password reset email to ${targetUser.email}`, error.stack);
      }
    }

    return genericResponse;
  }
}
