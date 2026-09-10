import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, Transform } from 'class-validator';

export class SignInDto {
    @IsEmail()
    @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;

    /**
     * Optional human-readable label for this device/session.
     * Example: "iPhone 14 Pro – Safari"
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    deviceLabel?: string;
}
