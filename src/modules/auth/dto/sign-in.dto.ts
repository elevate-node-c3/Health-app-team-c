import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SignInDto {
    @IsOptional()
    @IsString()
    @Transform(({ value, obj }) => {
        const v = typeof value === 'string' ? value.trim() : value;
        if (v) return v;
        const e = (obj as any)?.email;
        return typeof e === 'string' ? e.trim() : v;
    })
    identifier?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsNotEmpty()
    @IsString()
    @MinLength(8)
    password: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    deviceLabel?: string;
}

export const SigninDto = SignInDto;
export type SigninDto = SignInDto;
