import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
    /** The raw refresh token previously issued by the server. */
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}
