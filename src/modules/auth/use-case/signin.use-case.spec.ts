jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateTokens: jest.fn().mockReturnValue({
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token',
        }),
    })),
}));

jest.mock('../../../common/utils/hash.util', () => ({
    HashHelper: {
        comparePasswords: jest.fn(),
    },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { SigninUseCase } from './signin.use-case';
import { UserEntity, UserStatus, Gender } from '../entities/user.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { HashHelper } from '../../../common/utils/hash.util';
import { PromoteGuestUseCase } from './promote-guest.use-case';

describe('SigninUseCase', () => {
    let useCase: SigninUseCase;
    let userRepository: Partial<Repository<UserEntity>>;
    let tokenUtils: TokenUtils;
    let authTokenService: Partial<AuthTokenService>;
    let promoteGuestUseCase: Partial<PromoteGuestUseCase>;

    const mockUser: UserEntity = {
        id: 'user-uuid-123',
        fullName: 'Jane Doe',
        email: 'jane.doe@example.com',
        phoneNumber: '+201012345678',
        gender: Gender.FEMALE,
        passwordHash: '$2b$10$hashedpassword',
        status: UserStatus.PATIENT,
        isVerified: true,
        verificationCode: null,
        code_expires_at: null,
        failedAttemptsCount: 0,
        refreshTokens: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        userRepository = {
            findOne: jest.fn(),
        };

        authTokenService = {
            saveRefreshToken: jest.fn().mockResolvedValue(undefined),
        };

        promoteGuestUseCase = {
            execute: jest.fn().mockResolvedValue({ migratedCount: 0, skipped: null }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SigninUseCase,
                {
                    provide: getRepositoryToken(UserEntity),
                    useValue: userRepository,
                },
                TokenUtils,
                {
                    provide: AuthTokenService,
                    useValue: authTokenService,
                },
                {
                    provide: PromoteGuestUseCase,
                    useValue: promoteGuestUseCase,
                },
            ],
        }).compile();

        useCase = module.get<SigninUseCase>(SigninUseCase);
        tokenUtils = module.get<TokenUtils>(TokenUtils);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw BadRequestException ("Invalid email address") for malformed email format', async () => {
        const dto = { identifier: 'invalid-email-format@', password: 'Password123!' };
        await expect(useCase.execute(dto)).rejects.toThrow(
            new BadRequestException('Invalid email address'),
        );
    });

    it('should throw BadRequestException ("Invalid email address") if user email is not registered', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
        const dto = { identifier: 'nonexistent@example.com', password: 'Password123!' };

        await expect(useCase.execute(dto)).rejects.toThrow(
            new BadRequestException('Invalid email address'),
        );
    });

    it('should throw BadRequestException ("Invalid Phone Number") for malformed phone format', async () => {
        const dto = { identifier: '12345', password: 'Password123!' };
        await expect(useCase.execute(dto)).rejects.toThrow(
            new BadRequestException('Invalid Phone Number'),
        );
    });

    it('should throw BadRequestException ("Invalid Phone Number") if user phone is not registered', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
        const dto = { identifier: '01011112222', password: 'Password123!' };

        await expect(useCase.execute(dto)).rejects.toThrow(
            new BadRequestException('Invalid Phone Number'),
        );
    });

    it('should throw BadRequestException ("Incorrect Password") if password does not match', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);
        (HashHelper.comparePasswords as jest.Mock).mockResolvedValue(false);

        const dto = { identifier: 'jane.doe@example.com', password: 'WrongPassword' };

        await expect(useCase.execute(dto)).rejects.toThrow(
            new BadRequestException('Incorrect Password'),
        );
    });

    it('should successfully sign in with valid email and password', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);
        (HashHelper.comparePasswords as jest.Mock).mockResolvedValue(true);

        const dto = { identifier: 'jane.doe@example.com', password: 'CorrectPassword123!' };

        const result = await useCase.execute(dto);

        expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email: 'jane.doe@example.com' } });
        expect(HashHelper.comparePasswords).toHaveBeenCalledWith('CorrectPassword123!', mockUser.passwordHash);
        expect(authTokenService.saveRefreshToken).toHaveBeenCalledWith(mockUser.id, 'mock-refresh-token');
        expect(result).toEqual({
            statusCode: 200,
            message: 'Sign in successful',
            data: {
                user: {
                    id: mockUser.id,
                    fullName: mockUser.fullName,
                    email: mockUser.email,
                    phoneNumber: mockUser.phoneNumber,
                    status: mockUser.status,
                    isVerified: mockUser.isVerified,
                },
                tokens: {
                    accessToken: 'mock-access-token',
                    refreshToken: 'mock-refresh-token',
                },
            },
        });
    });

    it('should successfully sign in with valid phone number and password and promote guest session', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);
        (HashHelper.comparePasswords as jest.Mock).mockResolvedValue(true);

        const dto = { identifier: '01012345678', password: 'CorrectPassword123!' };

        const result = await useCase.execute(dto, 'guest-device-456');

        expect(userRepository.findOne).toHaveBeenCalledWith({ where: { phoneNumber: '+201012345678' } });
        expect(promoteGuestUseCase.execute).toHaveBeenCalledWith({
            guestDeviceId: 'guest-device-456',
            userId: mockUser.id,
        });
        expect(result.data.user.fullName).toBe('Jane Doe');
    });
});
