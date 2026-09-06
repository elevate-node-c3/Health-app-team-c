import { IsNotEmpty, IsString, IsEmail, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'Email cannot be blank.' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @IsNotEmpty({ message: 'Verification code cannot be blank.' })
  @IsString()
  @Length(4, 4, { message: 'Verification code must be exactly 4 digits.' })
  code: string;
}