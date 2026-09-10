import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { SignOutUseCase } from './sign-out.use-case';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';
import { AuthTokenService } from '../auth-token.service';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

// ── Mock factories ────────────────────────────────────────────────────────────

const mockOutboxRepo = {
    create: jest.fn().mockImplementation((v) => v),
    save: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
};

const mockRefreshTokenRepo = {
    findOne: jest.fn(),
};

const mockAuthTokenService = {
    revokeSession: jest.fn(),
    revokeAllSessionsForUser: jest.fn(),
    findActiveSessionsForUser: jest.fn(),
};

const mockOutboxProcessor = {
    triggerPublish: jest.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SignOutUseCase', () => {
    let useCase: SignOutUseCase;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SignOutUseCase,
                { provide: getRepositoryToken(OutboxEventEntity), useValue: mockOutboxRepo },
                { provide: getRepositoryToken(RefreshTokenEntity), useValue: mockRefreshTokenRepo },
                { provide: AuthTokenService, useValue: mockAuthTokenService },
                { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
            ],
        }).compile();

        useCase = module.get(SignOutUseCase);
    });

    describe('signOut', () => {
        it('successfully revokes session and publishes event', async () => {
            const rawToken = 'my-raw-refresh-token';
            const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            
            mockRefreshTokenRepo.findOne.mockResolvedValue({
                id: 'token-id',
                userId: 'user-123',
                familyId: 'family-123',
                tokenHash: expectedHash,
            });

            const result = await useCase.signOut({ refreshToken: rawToken }, 'user-123');

            expect(result).toEqual({ message: 'Signed out successfully.' });
            expect(mockRefreshTokenRepo.findOne).toHaveBeenCalledWith({ where: { tokenHash: expectedHash } });
            expect(mockAuthTokenService.revokeSession).toHaveBeenCalledWith('family-123');
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'session.ended',
                    payload: expect.objectContaining({ reason: 'user_signout' }),
                }),
            );
        });

        it('throws UnauthorizedException if token not found', async () => {
            mockRefreshTokenRepo.findOne.mockResolvedValue(null);

            await expect(
                useCase.signOut({ refreshToken: 'invalid-token' }, 'user-123'),
            ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });
            
            expect(mockAuthTokenService.revokeSession).not.toHaveBeenCalled();
        });

        it('throws UnauthorizedException if token belongs to another user', async () => {
            mockRefreshTokenRepo.findOne.mockResolvedValue({
                id: 'token-id',
                userId: 'other-user',
                familyId: 'family-123',
            });

            await expect(
                useCase.signOut({ refreshToken: 'valid-token' }, 'user-123'),
            ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });

            expect(mockAuthTokenService.revokeSession).not.toHaveBeenCalled();
        });
    });

    describe('signOutEverywhere', () => {
        it('revokes all sessions and publishes events for each', async () => {
            const mockSessions = [
                { familyId: 'family-1', deviceLabel: 'Device 1' },
                { familyId: 'family-2', deviceLabel: 'Device 2' },
            ];
            mockAuthTokenService.findActiveSessionsForUser.mockResolvedValue(mockSessions);

            const result = await useCase.signOutEverywhere('user-123');

            expect(result).toEqual({ message: 'Signed out from 2 session(s).' });
            expect(mockAuthTokenService.findActiveSessionsForUser).toHaveBeenCalledWith('user-123');
            expect(mockAuthTokenService.revokeAllSessionsForUser).toHaveBeenCalledWith('user-123');
            
            // It should publish an event for each session
            expect(mockOutboxRepo.save).toHaveBeenCalledTimes(2);
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ familyId: 'family-1', reason: 'signout_everywhere' })
                })
            );
            expect(mockOutboxRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ familyId: 'family-2', reason: 'signout_everywhere' })
                })
            );
        });
    });
});
