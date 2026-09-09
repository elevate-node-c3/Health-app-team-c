import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { SignupDto } from '../dto/sign-up.dto';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { normalizeEgyptianPhoneNumber } from '../../../common/utils/phone.util';
import { generateOtpCode, getOtpExpirationTime } from '../../../common/utils/otp.util';
import { HashHelper } from '../../../common/utils/hash.util';
import { maskEmail } from '../../../common/utils/email.utils';

@Injectable()
export class SignupUseCase {
    private readonly logger = new Logger(SignupUseCase.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly dataSource: DataSource,
        private readonly outboxProcessorService: OutboxProcessorService,
    ) { }

    async execute(dto: SignupDto, guestDeviceId?: string) {
        if (dto.password !== dto.confirmPassword) {
            throw new BadRequestException('Passwords do not match.');
        }

        const normalizedPhone = normalizeEgyptianPhoneNumber(dto.phoneNumber);
        const normalizedEmail = dto.email.toLowerCase().trim();

        const existingUserByEmail = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        const existingUserByPhone = await this.userRepository.findOne({ where: { phoneNumber: normalizedPhone } });

        const errors: string[] = [];
        if (existingUserByEmail && existingUserByEmail.isVerified) {
            errors.push('This email is already registered');
        }
        if (existingUserByPhone && existingUserByPhone.isVerified) {
            errors.push('This phone number is already registered');
        }

        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }

        let user = existingUserByEmail || existingUserByPhone;
        const hashedPassword = await HashHelper.hashPassword(dto.password);
        const otpCode = generateOtpCode(4);
        const otpExpiresAt = getOtpExpirationTime(3);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let savedOutboxEventId: string;
        let savedGuestPromotedEventId: string | undefined;

        const normalizedGuestDeviceId = guestDeviceId?.trim() || undefined;
        const bookingIntent = (dto as any).bookingIntent as Record<string, any> | undefined;

        try {
            if (user && !user.isVerified) {
                user.fullName = dto.fullName;
                user.email = normalizedEmail;
                user.phoneNumber = normalizedPhone;
                user.gender = dto.gender;
                user.passwordHash = hashedPassword;
                user.verificationCode = otpCode;
                user.code_expires_at = otpExpiresAt;
                user.failedAttemptsCount = 0;
            } else {
                user = queryRunner.manager.create(UserEntity, {
                    fullName: dto.fullName,
                    email: normalizedEmail,
                    phoneNumber: normalizedPhone,
                    gender: dto.gender,
                    passwordHash: hashedPassword,
                    status: UserStatus.UNVERIFIED_PATIENT,
                    verificationCode: otpCode,
                    code_expires_at: otpExpiresAt,
                    isVerified: false,
                });
            }

            await queryRunner.manager.save(user);

            const outboxEvent = queryRunner.manager.create(OutboxEventEntity, {
                aggregateType: 'USER',
                eventType: 'user.registered',
                payload: {
                    userId: user.id,
                    email: user.email,
                    otpCode: otpCode,
                },
                isProcessed: false,
            });

            const savedEvent = await queryRunner.manager.save(outboxEvent);
            savedOutboxEventId = savedEvent.id;

            if (normalizedGuestDeviceId) {
                const guestPromotedEvent = queryRunner.manager.create(OutboxEventEntity, {
                    aggregateType: 'USER',
                    eventType: 'guest.promoted',
                    payload: {
                        guestDeviceId: normalizedGuestDeviceId,
                        userId: user.id,
                        bookingIntent: bookingIntent ?? null,
                    },
                    isProcessed: false,
                });
                const savedGuestEvent = await queryRunner.manager.save(guestPromotedEvent);
                savedGuestPromotedEventId = savedGuestEvent.id;
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }

        if (savedOutboxEventId) {
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(savedOutboxEventId).catch((err) => {
                    this.logger.error(`Instant outbox publish failed for event ID ${savedOutboxEventId}: ${err.message}`);
                });
            });
        }
        if (savedGuestPromotedEventId) {
            setImmediate(() => {
                this.outboxProcessorService.triggerPublish(savedGuestPromotedEventId!).catch((err) => {
                    this.logger.error(`Instant outbox publish failed for guest.promoted event ID ${savedGuestPromotedEventId}: ${err.message}`);
                });
            });
        }

        const responseData: any = {
            userId: user.id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phoneNumber,
            status: user.status,
            isVerified: user.isVerified,
        };
        if (bookingIntent) {
            responseData.pendingBookingIntent = bookingIntent;
        } else if (normalizedGuestDeviceId) {
            responseData.pendingBookingIntent = null;
        }

        return {
            statusCode: 201,
            message: `Registration successful. Verification code sent. in your email ${maskEmail(user.email)}`,
            data: responseData,
        };
    }
}