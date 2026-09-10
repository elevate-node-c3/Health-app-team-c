import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResetPasswordDto {
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

  @IsNotEmpty({ message: 'Reset token cannot be blank.' })
  @IsString()
  resetToken: string;

  @IsNotEmpty({ message: 'Password cannot be blank.' })
  @MinLength(8, { message: 'Password is too weak. Please use at least 8 characters, including a mix of letters, numbers, and symbols.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/, {
    message: 'Password is too weak. Please use at least 8 characters, including a mix of letters, numbers, and symbols.',
  })
  password: string;

  @IsNotEmpty({ message: 'Confirm password cannot be blank.' })
  @IsString()
  confirmPassword: string;
}
