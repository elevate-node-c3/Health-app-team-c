import {
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsString,
    Matches,
    MinLength
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender } from '../entities/user.entity';

export class SignupDto {
    @IsNotEmpty({ message: 'Name cannot be blank.' })
    @IsString()
    fullName: string;

    @IsNotEmpty({ message: 'Email cannot be blank.' })
    @IsEmail({}, { message: 'Invalid email format.' })
    @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
    email: string;

    @IsNotEmpty({ message: 'Phone number cannot be blank.' })
    @IsString()
    @Matches(/^(\+20|0)?1[0125][0-9]{8}$/, {
        message: 'Please enter a valid Egyptian mobile number.'
    })
    phoneNumber: string;

    @IsNotEmpty({ message: 'Gender cannot be blank.' })
    @IsEnum(Gender, { message: 'Gender must be strictly Male or Female.' })
    gender: Gender;

    @IsNotEmpty({ message: 'Password cannot be blank.' })
    @MinLength(8, { message: 'Password is too weak. Please use at least 8 characters, including a mix of letters, numbers, and symbols.' })
    @Matches(
        /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/,
        { message: 'Password is too weak. Please use at least 8 characters, including a mix of letters, numbers, and symbols.' }
    )
    password: string;

    @IsNotEmpty({ message: 'Confirm password cannot be blank.' })
    @IsString()
    confirmPassword: string;
}