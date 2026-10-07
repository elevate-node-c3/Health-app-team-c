jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateAccessToken: jest.fn().mockReturnValue('access-token-mock'),
    })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SignInUseCase } from './sign-in.use-case';
import { UserEntity, UserStatus, Gender } from '../entities/user.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { PromoteGuestUseCase } from './promote-guest.use-case';
import { MigrateGuestConversationsUseCase } from 'src/modules/ai-assistant/use-cases/migrate-guest-conversations.use-case';
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
        passwordResetCode: null,
        passwordResetCodeUsedAt: null,
        passwordResetCodeExpiresAt: null,
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
        passwordResetAttemptsCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

// ── Mock factories ────────────────────────────────────────────────────────────

const mockRefreshTokenRepo = {
    save: jest.fn(),
    create: jest.fn().mockImplementation((v) => v),
};

const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
        getRepository: jest.fn().mockReturnValue(mockRefreshTokenRepo),
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

const mockPromoteGuestUseCase = {
    execute: jest.fn().mockResolvedValue(undefined),
};

const mockMigrateGuestConversationsUseCase = {
    execute: jest.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SignInUseCase', () => {
    let useCase: SignInUseCase;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockRefreshTokenRepo.save.mockReset();
        mockQueryRunner.manager.save.mockResolvedValue({ id: 'outbox-event-id' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SignInUseCase,
                { provide: getRepositoryToken(UserEntity), useValue: mockUserRepo },
                { provide: TokenUtils, useValue: mockTokenUtils },
                { provide: AuthTokenService, useValue: {} },
                { provide: DataSource, useValue: mockDataSource },
                { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
                { provide: PromoteGuestUseCase, useValue: mockPromoteGuestUseCase },
                { provide: MigrateGuestConversationsUseCase, useValue: mockMigrateGuestConversationsUseCase },
            ],
        }).compile();

        useCase = module.get(SignInUseCase);
    });

    describe('happy path', () => {
        it('returns an access token and refresh token for valid credentials', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            const result = await useCase.execute({
                email: 'jane@example.com',
                password: 'Password1!',
                deviceLabel: 'iPhone 14',
            } as any);

            expect(result.data.accessToken).toBe('access-token-mock');
            expect(result.data.refreshToken).toBeDefined();
            expect(result.data.expiresIn).toBe(900);
            expect(mockRefreshTokenRepo.save).toHaveBeenCalledTimes(1);
        });

        it('normalises email to lowercase before lookup', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            await useCase.execute({ email: 'JANE@EXAMPLE.COM', password: 'Password1!' } as any);

            expect(mockUserRepo.findOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { email: 'jane@example.com' } }),
            );
        });

        it('signs in successfully with a valid Egyptian phone number', async () => {
            const user = buildUser({ email: undefined, phoneNumber: '+201012345678' });
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            const result = await useCase.execute({
                identifier: '01012345678',
                password: 'Password1!',
            } as any);

            expect(mockUserRepo.findOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { phoneNumber: '+201012345678' } }),
            );
            expect(result.data.accessToken).toBe('access-token-mock');
        });

        it('promotes guest device and migrates guest conversations when guestDeviceId is provided', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            const result = await useCase.execute(
                { email: 'jane@example.com', password: 'Password1!' } as any,
                'device-123',
            );

            expect(mockPromoteGuestUseCase.execute).toHaveBeenCalledWith({
                guestDeviceId: 'device-123',
                userId: user.id,
            });
            expect(mockMigrateGuestConversationsUseCase.execute).toHaveBeenCalledWith(
                'device-123',
                user.id,
            );
            expect(result.data.accessToken).toBe('access-token-mock');
        });

        it('swallows a promotion failure without failing sign-in and still migrates conversations', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);
            mockPromoteGuestUseCase.execute.mockRejectedValueOnce(new Error('already linked'));

            const result = await useCase.execute(
                { email: 'jane@example.com', password: 'Password1!' } as any,
                'device-123',
            );

            expect(mockPromoteGuestUseCase.execute).toHaveBeenCalledWith({
                guestDeviceId: 'device-123',
                userId: user.id,
            });
            expect(mockMigrateGuestConversationsUseCase.execute).toHaveBeenCalledWith(
                'device-123',
                user.id,
            );
            expect(result.data.accessToken).toBe('access-token-mock');
        });
    });

    describe('invalid credentials', () => {
        it('throws UnauthorizedException when user is not found', async () => {
            mockUserRepo.findOne.mockResolvedValue(null);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(false);

            await expect(
                useCase.execute({ email: 'ghost@example.com', password: 'any' } as any),
            ).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when password is wrong', async () => {
            const user = buildUser();
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(false);

            await expect(
                useCase.execute({ email: 'jane@example.com', password: 'WrongPass!' } as any),
            ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
        });

        it('throws BadRequestException when the account has no password (social-login only)', async () => {
            const user = buildUser({ passwordHash: null as any });
            mockUserRepo.findOne.mockResolvedValue(user);

            await expect(
                useCase.execute({ email: 'jane@example.com', password: 'anything' } as any),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('unverified user', () => {
        it('throws UnauthorizedException with EMAIL_NOT_VERIFIED when isVerified=false', async () => {
            const user = buildUser({ isVerified: false });
            mockUserRepo.findOne.mockResolvedValue(user);
            jest.spyOn(HashHelper, 'comparePasswords').mockResolvedValue(true);

            await expect(
                useCase.execute({ email: 'jane@example.com', password: 'Password1!' } as any),
            ).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_VERIFIED' } });
        });
    });
});