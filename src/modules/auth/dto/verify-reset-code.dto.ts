import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class VerifyResetCodeDto {
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

  @IsNotEmpty({ message: 'Verification code cannot be blank.' })
  @IsString()
  @Length(4, 4, { message: 'Verification code must be exactly 4 digits.' })
  @Matches(/^\d{4}$/, { message: 'Verification code must be exactly 4 digits.' })
  code: string;
}
