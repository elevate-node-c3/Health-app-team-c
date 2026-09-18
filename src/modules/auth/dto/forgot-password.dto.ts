import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export enum PasswordResetChannel {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
}

export class ForgotPasswordDto {
  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\+20|0)?1[0125][0-9]{8}$/, {
    message: 'Please enter a valid Egyptian mobile number.',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsEnum(PasswordResetChannel, { message: 'Reset channel must be EMAIL or PHONE.' })
  channel?: PasswordResetChannel;
}

export { PasswordResetChannel as ResetChannel };
