jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateTokens: jest.fn().mockReturnValue({
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token',
        }),
    })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { VerifyEmailUseCase } from './verify-email.use-case';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';

describe('VerifyEmailUseCase', () => {
    let useCase: VerifyEmailUseCase;
    let userRepository: Partial<Repository<UserEntity>>;
    let tokenUtils: TokenUtils;
    let authTokenService: Partial<AuthTokenService>;

    beforeEach(async () => {
        userRepository = {
            findOne: jest.fn(),
            save: jest.fn().mockImplementation((user) => Promise.resolve(user)),
        };

        authTokenService = {
            saveRefreshToken: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                VerifyEmailUseCase,
                {
                    provide: getRepositoryToken(UserEntity),
                    useValue: userRepository,
                },
                TokenUtils,
                {
                    provide: AuthTokenService,
                    useValue: authTokenService,
                },
            ],
        }).compile();

        useCase = module.get<VerifyEmailUseCase>(VerifyEmailUseCase);
        tokenUtils = module.get<TokenUtils>(TokenUtils);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw NotFoundException if user email does not exist', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

        const dto: any = { email: 'notfound@example.com', code: '1234' };

        await expect(useCase.execute(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if account is already verified', async () => {
        const verifiedUser = { isVerified: true } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(verifiedUser);

        const dto: any = { email: 'test@example.com', code: '1234' };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if failed attempts limit reached', async () => {
        const lockedUser = {
            isVerified: false,
            failedAttemptsCount: 5,
        } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(lockedUser);

        const dto: any = { email: 'test@example.com', code: '1234' };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if verification code has expired', async () => {
        const expiredUser = {
            isVerified: false,
            failedAttemptsCount: 0,
            code_expires_at: new Date(Date.now() - 10000),
        } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(expiredUser);

        const dto: any = { email: 'test@example.com', code: '1234' };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should increment failed attempts and throw BadRequestException if code is invalid', async () => {
        const user = {
            isVerified: false,
            failedAttemptsCount: 1,
            code_expires_at: new Date(Date.now() + 100000),
            verificationCode: '5678',
        } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

        const dto: any = { email: 'test@example.com', code: '1234' };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
        expect(user.failedAttemptsCount).toBe(2);
        expect(userRepository.save).toHaveBeenCalledWith(user);
    });

    it('should successfully verify email, generate tokens and update user status', async () => {
        const user = {
            id: 'user-id-123',
            email: 'test@example.com',
            isVerified: false,
            failedAttemptsCount: 0,
            code_expires_at: new Date(Date.now() + 100000),
            verificationCode: '1234',
        } as UserEntity;

        jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

        const dto: any = { email: 'test@example.com', code: '1234' };

        const result = await useCase.execute(dto);

        expect(user.isVerified).toBe(true);
        expect(user.status).toBe(UserStatus.PATIENT);
        expect(user.verificationCode).toBeNull();
        expect(user.code_expires_at).toBeNull();
        expect(user.failedAttemptsCount).toBe(0);
        expect(userRepository.save).toHaveBeenCalledWith(user);
        expect(tokenUtils.generateTokens).toHaveBeenCalledWith({
            sub: 'user-id-123',
            email: 'test@example.com',
            status: UserStatus.PATIENT,
        });
        expect(authTokenService.saveRefreshToken).toHaveBeenCalledWith('user-id-123', 'mock-refresh-token');
        expect(result).toEqual({
            message: 'Email verified successfully.',
            data: {
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
                isVerified: true,
            },
        });
    });
});