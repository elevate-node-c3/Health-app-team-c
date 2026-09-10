jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateAccessToken: jest.fn().mockReturnValue('access-token-mock'),
    })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SignInUseCase } from './sign-in.use-case';
import { UserEntity, UserStatus, Gender } from '../entities/user.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { HashHelper } from '../../../common/utils/hash.util';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
    return {
        id: 'user-uuid',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phoneNumber: '+201234567890',
        gender: Gender.FEMALE,
        passwordHash: '$2b$10$hashedPassword',
        status: UserStatus.PATIENT,
        isVerified: true,
        verificationCode: null,
        code_expires_at: null,
        failedAttemptsCount: 0,
        refreshTokens: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

// ── Mock factories ────────────────────────────────────────────────────────────

const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
        getRepository: jest.fn().mockReturnValue({
            save: jest.fn(),
            create: jest.fn().mockImplementation((v) => v),
        }),
        create: jest.fn().mockImplementation((_entity, dto) => dto),
        save: jest.fn().mockResolvedValue({ id: 'outbox-event-id' }),
    },
};

const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
};

const mockUserRepo = {
    findOne: jest.fn(),
};

const mockTokenUtils = {
    generateAccessToken: jest.fn().mockReturnValue('access-token-mock'),
};

const mockOutboxProcessor = {
    triggerPublish: jest.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SignInUseCase', () => {
    let useCase: SignInUseCase;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SignInUseCase,
                { provide: getRepositoryToken(UserEntity), useValue: mockUserRepo },
                { provide: TokenUtils, useValue: mockTokenUtils },
                { provide: AuthTokenService, useValue: {} },
                { provide: DataSource, useValue: mockDataSource },
                { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
            ],
        }).compile();

        useCase = module.get(SignInUseCase);
    });

    describe('happy path', () => {
        it('returns an access token and refresh token for valid credentials', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);
            mockQueryRunner.manager.save.mockResolvedValue({ id: 'outbox-event-id' });

            const result = await useCase.execute({
                email: 'jane@example.com',
                password: 'Password1!',
                deviceLabel: 'iPhone 14',
            });

            expect(result.data.accessToken).toBe('access-token-mock');
            expect(result.data.refreshToken).toBeDefined();
            expect(result.data.expiresIn).toBe(900);
        });

        it('normalises email to lowercase before lookup', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            await useCase.execute({ email: 'JANE@EXAMPLE.COM', password: 'Password1!' });

            expect(mockUserRepo.findOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { email: 'jane@example.com' } }),
            );
        });
    });

    describe('invalid credentials', () => {
        it('throws UnauthorizedException when user is not found', async () => {
            mockUserRepo.findOne.mockResolvedValue(null);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(false);

            await expect(
                useCase.execute({ email: 'ghost@example.com', password: 'any' }),
            ).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when password is wrong', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(false);

            await expect(
                useCase.execute({ email: 'jane@example.com', password: 'WrongPass!' }),
            ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
        });
    });

    describe('unverified user', () => {
        it('throws UnauthorizedException with EMAIL_NOT_VERIFIED when isVerified=false', async () => {
            const user = buildUser({ isVerified: false });
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            await expect(
                useCase.execute({ email: 'jane@example.com', password: 'Password1!' }),
            ).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_VERIFIED' } });
        });
    });
});
