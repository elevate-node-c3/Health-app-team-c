// jest.mock('../../../common/utils/token.utils', () => ({
//     TokenUtils: jest.fn().mockImplementation(() => ({
//         generateAccessToken: jest.fn().mockReturnValue('new-access-token'),
//     })),
// }));

// import { Test, TestingModule } from '@nestjs/testing';
// import { getRepositoryToken } from '@nestjs/typeorm';
// import { UnauthorizedException } from '@nestjs/common';
// import { DataSource } from 'typeorm';
// import { RefreshTokenUseCase } from './refresh-token.use-case';
// import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
// import { TokenUtils } from '../../../common/utils/token.utils';
// import { AuthTokenService, RotationResult } from '../auth-token.service';
// import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
// import { UserStatus } from '../entities/user.entity';

// // ── Mock factories ────────────────────────────────────────────────────────────

// const makeRotationResult = (overrides: Partial<RotationResult> = {}): RotationResult => ({
//     rawRefreshToken: 'new-raw-token',
//     familyId: 'family-uuid',
//     userId: 'user-uuid',
//     userStatus: UserStatus.PATIENT,
//     userEmail: 'jane@example.com',
//     ...overrides,
// });

// const mockAuthTokenService = {
//     rotateRefreshToken: jest.fn(),
//     findActiveSessionsForUser: jest.fn(),
// };

// const mockTokenUtils = {
//     generateAccessToken: jest.fn().mockReturnValue('new-access-token'),
// };

// const mockOutboxRepo = {
//     create: jest.fn().mockImplementation((v) => v),
//     save: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
// };

// const mockOutboxProcessor = {
//     triggerPublish: jest.fn().mockResolvedValue(undefined),
// };

// // ── Tests ─────────────────────────────────────────────────────────────────────

// describe('RefreshTokenUseCase', () => {
//     let useCase: RefreshTokenUseCase;

//     beforeEach(async () => {
//         jest.clearAllMocks();

//         const module: TestingModule = await Test.createTestingModule({
//             providers: [
//                 RefreshTokenUseCase,
//                 { provide: getRepositoryToken(OutboxEventEntity), useValue: mockOutboxRepo },
//                 { provide: TokenUtils, useValue: mockTokenUtils },
//                 { provide: AuthTokenService, useValue: mockAuthTokenService },
//                 { provide: DataSource, useValue: {} },
//                 { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
//             ],
//         }).compile();

//         useCase = module.get(RefreshTokenUseCase);
//     });

//     describe('happy path rotation', () => {
//         it('returns a new access token and new refresh token', async () => {
//             mockAuthTokenService.rotateRefreshToken.mockResolvedValue(makeRotationResult());

//             const result = await useCase.execute({ refreshToken: 'old-raw-token' });

//             expect(result.data.accessToken).toBe('new-access-token');
//             expect(result.data.refreshToken).toBe('new-raw-token');
//             expect(result.data.expiresIn).toBe(900);
//         });

//         it('generates access token with the familyId from the rotation result', async () => {
//             mockAuthTokenService.rotateRefreshToken.mockResolvedValue(makeRotationResult());

//             await useCase.execute({ refreshToken: 'old-raw-token' });

//             expect(mockTokenUtils.generateAccessToken).toHaveBeenCalledWith(
//                 expect.objectContaining({ familyId: 'family-uuid', sub: 'user-uuid' }),
//             );
//         });
//     });

//     describe('expired token', () => {
//         it('propagates SESSION_EXPIRED from rotateRefreshToken', async () => {
//             mockAuthTokenService.rotateRefreshToken.mockRejectedValue(
//                 new UnauthorizedException({ code: 'SESSION_EXPIRED' }),
//             );

//             await expect(useCase.execute({ refreshToken: 'expired-token' })).rejects.toMatchObject({
//                 response: { code: 'SESSION_EXPIRED' },
//             });
//         });
//     });

//     describe('theft detection', () => {
//         it('propagates SESSION_COMPROMISED when rotateRefreshToken detects reuse', async () => {
//             mockAuthTokenService.rotateRefreshToken.mockRejectedValue(
//                 new UnauthorizedException({ code: 'SESSION_COMPROMISED' }),
//             );

//             await expect(
//                 useCase.execute({ refreshToken: 'already-rotated-token' }),
//             ).rejects.toMatchObject({ response: { code: 'SESSION_COMPROMISED' } });
//         });
//     });

//     describe('publishTheftEvent', () => {
//         it('writes a session.theft_detected outbox event', async () => {
//             await useCase.publishTheftEvent('user-uuid', 'family-uuid');

//             expect(mockOutboxRepo.save).toHaveBeenCalledWith(
//                 expect.objectContaining({ eventType: 'session.theft_detected' }),
//             );
//         });
//     });
// });


import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RefreshTokenUseCase } from './refresh-token.use-case';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService, RotationResult } from '../auth-token.service';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { UserStatus } from '../entities/user.entity';

// 1. عمل Mock لـ TokenUtils بالكامل لتجنب تحميل JwtService الحقيقي
jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateAccessToken: jest.fn().mockReturnValue('new-access-token'),
        verifyAccessToken: jest.fn(),
    })),
}));

// ── Mock factories ────────────────────────────────────────────────────────────

const makeRotationResult = (overrides: Partial<RotationResult> = {}): RotationResult => ({
    rawRefreshToken: 'new-raw-token',
    familyId: 'family-uuid',
    userId: 'user-uuid',
    userStatus: UserStatus.PATIENT,
    userEmail: 'jane@example.com',
    fullName: 'Jane Doe',
    ...overrides,
});

const mockAuthTokenService = {
    rotateRefreshToken: jest.fn(),
    findActiveSessionsForUser: jest.fn(),
};

const mockTokenUtils = {
    generateAccessToken: jest.fn().mockReturnValue('new-access-token'),
};

const mockOutboxRepo = {
    create: jest.fn().mockImplementation((v) => v),
    save: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
};

const mockOutboxProcessor = {
    triggerPublish: jest.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RefreshTokenUseCase', () => {
    let useCase: RefreshTokenUseCase;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RefreshTokenUseCase,
                { provide: getRepositoryToken(OutboxEventEntity), useValue: mockOutboxRepo },
                { provide: TokenUtils, useValue: mockTokenUtils },
                { provide: AuthTokenService, useValue: mockAuthTokenService },
                { provide: DataSource, useValue: {} },
                { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
            ],
        }).compile();

        useCase = module.get(RefreshTokenUseCase);
    });

    describe('happy path rotation', () => {
        it('returns a new access token and new refresh token', async () => {
            mockAuthTokenService.rotateRefreshToken.mockResolvedValue(makeRotationResult());

            const result = await useCase.execute({ refreshToken: 'old-raw-token' });

            expect(result.data.accessToken).toBe('new-access-token');
            expect(result.data.refreshToken).toBe('new-raw-token');
            expect(result.data.expiresIn).toBe(900);
        });

        it('generates access token with the familyId and details from the rotation result', async () => {
            mockAuthTokenService.rotateRefreshToken.mockResolvedValue(makeRotationResult());

            await useCase.execute({ refreshToken: 'old-raw-token' });

            expect(mockTokenUtils.generateAccessToken).toHaveBeenCalledWith(
                expect.objectContaining({
                    familyId: 'family-uuid',
                    sub: 'user-uuid',
                    email: 'jane@example.com',
                    fullName: 'Jane Doe'
                }),
            );
        });
    });

    describe('expired token', () => {
        it('propagates SESSION_EXPIRED from rotateRefreshToken', async () => {
            mockAuthTokenService.rotateRefreshToken.mockRejectedValue(
                new UnauthorizedException({ code: 'SESSION_EXPIRED' }),
            );

            await expect(useCase.execute({ refreshToken: 'expired-token' })).rejects.toMatchObject({
                response: { code: 'SESSION_EXPIRED' },
            });
        });
    });

    describe('theft detection', () => {
        it('propagates SESSION_COMPROMISED when rotateRefreshToken detects reuse', async () => {
            mockAuthTokenService.rotateRefreshToken.mockRejectedValue(
                new UnauthorizedException({ code: 'SESSION_COMPROMISED' }),
            );

            await expect(
                useCase.execute({ refreshToken: 'already-rotated-token' }),
            ).rejects.toMatchObject({ response: { code: 'SESSION_COMPROMISED' } });
        });
    });

    describe('publishTheftEvent', () => {
        it('writes a session.theft_detected outbox event', async () => {
            await useCase.publishTheftEvent('user-uuid', 'family-uuid');

            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'session.theft_detected' }),
            );
        });
    });
});