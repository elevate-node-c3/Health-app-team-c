import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class SigninDto {
    @IsNotEmpty({ message: 'Email or phone number cannot be blank.' })
    @IsString()
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    identifier: string;

    @IsNotEmpty({ message: 'Password cannot be blank.' })
    @IsString()
    password: string;
}
