import { IsNotEmpty, IsString } from 'class-validator';

export class SignOutDto {
    /**
     * The raw refresh token for the session to terminate.
     * Required so a stolen access token alone cannot forcibly sign out the real user.
     */
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}
