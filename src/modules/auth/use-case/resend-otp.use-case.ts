import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { ResendOtpDto } from '../dto/resend-otp.dto';
import { generateOtpCode, getOtpExpirationTime } from '../../../common/utils/otp.util';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ResendOtpUseCase {
    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly eventEmitter: EventEmitter2,
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

        await this.userRepository.save(user);

        this.eventEmitter.emit('user.registered', {
            userId: user.id,
            email: user.email,
            otpCode: newOtpCode,
        });

        return {
            message: 'A new verification code has been sent to your email.',
        };
    }
}