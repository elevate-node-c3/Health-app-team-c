import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { SignupDto } from '../dto/sign-up.dto';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { normalizeEgyptianPhoneNumber } from '../../../common/utils/phone.util';
import { generateOtpCode, getOtpExpirationTime } from '../../../common/utils/otp.util';
import { HashHelper } from '../../../common/utils/hash.util';
import { maskEmail } from 'src/common/utils/email.utils';

@Injectable()
export class SignupUseCase {
    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly dataSource: DataSource,
    ) { }

    async execute(dto: SignupDto) {
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

            await queryRunner.manager.save(outboxEvent);

            await queryRunner.commitTransaction();

            return {
                statusCode: 201,
                message: `Registration successful. Verification code sent. in your email ${maskEmail(user.email)}`,
                data: {
                    userId: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    phone: user.phoneNumber,
                    status: user.status,
                    isVerified: user.isVerified,
                },
            };
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
}