import { IsNotEmpty, IsString, IsEmail } from 'class-validator';

export class ResendOtpDto {
    @IsNotEmpty({ message: 'Email cannot be blank.' })
    @IsEmail({}, { message: 'Please enter a valid email address.' })
    email: string;
}