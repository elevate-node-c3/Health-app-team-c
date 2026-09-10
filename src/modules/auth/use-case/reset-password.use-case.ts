import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { HashHelper } from '../../../common/utils/hash.util';
import { MailService } from '../../../common/mail/mail.service';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    private readonly mailService: MailService,
  ) {}

  async execute(dto: ResetPasswordDto) {
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
        message: 'If an account matches this information, the password was reset successfully.',
        data: {},
      };
    }

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    if (!user.passwordResetToken || !user.passwordResetTokenExpiresAt) {
      throw new BadRequestException('This password reset session is invalid or has expired.');
    }

    if (user.passwordResetTokenExpiresAt.getTime() <= Date.now()) {
      user.passwordResetToken = null;
      user.passwordResetTokenExpiresAt = null;
      await this.userRepository.save(user);
      throw new BadRequestException('This password reset session has expired. Please request a new reset code.');
    }

    if (dto.resetToken !== user.passwordResetToken) {
      throw new BadRequestException('Invalid or expired password reset session.');
    }

    const isSameAsCurrentPassword = user.passwordHash ? await HashHelper.comparePasswords(dto.password, user.passwordHash) : false;
    if (isSameAsCurrentPassword) {
      throw new BadRequestException('The new password cannot be the same as the current one.');
    }

    const hashedPassword = await HashHelper.hashPassword(dto.password);
    user.passwordHash = hashedPassword;
    user.passwordResetCode = null;
    user.passwordResetCodeExpiresAt = null;
    user.passwordResetCodeUsedAt = new Date();
    user.passwordResetToken = null;
    user.passwordResetTokenExpiresAt = null;
    user.passwordResetAttemptsCount = 0;

    await this.userRepository.save(user);
    await this.refreshTokenRepository.delete({ userId: user.id });

    try {
      await this.mailService.sendPasswordChangedEmail(user.email, user.phoneNumber);
    } catch (error) {
      // Logging is handled in the mail service; we intentionally swallow notification failures to keep password reset itself successful.
    }

    return {
      statusCode: 200,
      message: 'Password changed successfully. Your account has been secured and all active sessions were terminated.',
      data: {
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
    };
  }
}
