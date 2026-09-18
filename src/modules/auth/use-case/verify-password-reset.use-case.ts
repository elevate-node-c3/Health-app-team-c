import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { UserEntity } from '../entities/user.entity';
import { VerifyResetCodeDto } from '../dto/verify-reset-code.dto';

@Injectable()
export class VerifyPasswordResetUseCase {
  private readonly logger = new Logger(VerifyPasswordResetUseCase.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async execute(dto: VerifyResetCodeDto) {
    const normalizedEmail = dto.email?.toLowerCase().trim();
    const normalizedPhone = dto.phoneNumber ? dto.phoneNumber.trim() : undefined;

    const user = normalizedEmail
      ? await this.userRepository.findOne({ where: { email: normalizedEmail } })
      : normalizedPhone
        ? await this.userRepository.findOne({ where: { phoneNumber: normalizedPhone } })
        : null;

    if (!user) {
      return {
        statusCode: 200,
        message: 'If an account matches this information, the reset code is valid and the user can continue to set a new password.',
        data: {},
      };
    }

    if (!user.passwordResetCode || !user.passwordResetCodeExpiresAt) {
      throw new BadRequestException('No active password reset request was found for this account.');
    }

    if (user.passwordResetCodeExpiresAt.getTime() <= Date.now()) {
      user.passwordResetCode = null;
      user.passwordResetCodeExpiresAt = null;
      user.passwordResetAttemptsCount = 0;
      await this.userRepository.save(user);
      throw new BadRequestException('The reset code has expired. Please request a new one.');
    }

    if (user.passwordResetCode !== dto.code) {
      user.passwordResetAttemptsCount += 1;
      await this.userRepository.save(user);
      throw new BadRequestException('Invalid reset code. Please try again.');
    }

    const resetToken = randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.passwordResetCode = null;
    user.passwordResetCodeExpiresAt = null;
    user.passwordResetCodeUsedAt = new Date();
    user.passwordResetAttemptsCount = 0;
    await this.userRepository.save(user);

    return {
      statusCode: 200,
      message: 'Reset code verified successfully.',
      data: {
        resetToken,
        expiresAt: user.passwordResetTokenExpiresAt,
      },
    };
  }
}
