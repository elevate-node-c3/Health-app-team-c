jest.mock('../../../common/utils/token.utils', () => ({
    TokenUtils: jest.fn().mockImplementation(() => ({
        generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
    })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { VerifyEmailUseCase } from './verify-email.use-case';
import { UserEntity, UserStatus, Gender } from '../entities/user.entity';
import { TokenUtils } from '../../../common/utils/token.utils';
import { AuthTokenService } from '../auth-token.service';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

describe('VerifyEmailUseCase', () => {
    let useCase: VerifyEmailUseCase;
    
    const mockUserRepo = {
        findOne: jest.fn(),
        save: jest.fn(),
    };

    const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
            save: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
            getRepository: jest.fn().mockReturnValue({
                create: jest.fn().mockImplementation((v) => v),
                save: jest.fn(),
            }),
            create: jest.fn().mockImplementation((_entity, v) => v),
        },
    };

    const mockDataSource = {
        createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const mockTokenUtils = {
        generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
    };

    const mockOutboxProcessor = {
        triggerPublish: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                VerifyEmailUseCase,
                { provide: getRepositoryToken(UserEntity), useValue: mockUserRepo },
                { provide: TokenUtils, useValue: mockTokenUtils },
                { provide: AuthTokenService, useValue: {} },
                { provide: DataSource, useValue: mockDataSource },
                { provide: OutboxProcessorService, useValue: mockOutboxProcessor },
            ],
        }).compile();

        useCase = module.get(VerifyEmailUseCase);
    });

    it('should throw NotFoundException if user email does not exist', async () => {
        mockUserRepo.findOne.mockResolvedValue(null);
        await expect(useCase.execute({ email: 'notfound@example.com', code: '1234' })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if account is already verified', async () => {
        mockUserRepo.findOne.mockResolvedValue({ isVerified: true } as UserEntity);
        await expect(useCase.execute({ email: 'test@example.com', code: '1234' })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if failed attempts limit reached', async () => {
        mockUserRepo.findOne.mockResolvedValue({ isVerified: false, failedAttemptsCount: 5 } as UserEntity);
        await expect(useCase.execute({ email: 'test@example.com', code: '1234' })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if verification code has expired', async () => {
        mockUserRepo.findOne.mockResolvedValue({
            isVerified: false,
            failedAttemptsCount: 0,
            code_expires_at: new Date(Date.now() - 10000),
        } as UserEntity);
        await expect(useCase.execute({ email: 'test@example.com', code: '1234' })).rejects.toThrow(BadRequestException);
    });

    it('should increment failed attempts and throw BadRequestException if code is invalid', async () => {
        const user = {
            isVerified: false,
            failedAttemptsCount: 1,
            code_expires_at: new Date(Date.now() + 100000),
            verificationCode: '5678',
        } as UserEntity;
        mockUserRepo.findOne.mockResolvedValue(user);

        await expect(useCase.execute({ email: 'test@example.com', code: '1234' })).rejects.toThrow(BadRequestException);
        expect(user.failedAttemptsCount).toBe(2);
        expect(mockUserRepo.save).toHaveBeenCalledWith(user);
    });

    it('should successfully verify email and generate token family within a transaction', async () => {
        const user = {
            id: 'user-id-123',
            email: 'test@example.com',
            isVerified: false,
            failedAttemptsCount: 0,
            code_expires_at: new Date(Date.now() + 100000),
            verificationCode: '1234',
        } as UserEntity;

        mockUserRepo.findOne.mockResolvedValue(user);

        const result = await useCase.execute({ email: 'test@example.com', code: '1234' });

        expect(user.isVerified).toBe(true);
        expect(user.status).toBe(UserStatus.PATIENT);
        expect(user.verificationCode).toBeNull();
        expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(user);
        
        // Assert session created and tokens returned
        expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
        expect(mockTokenUtils.generateAccessToken).toHaveBeenCalledWith(
            expect.objectContaining({ sub: 'user-id-123', email: 'test@example.com' })
        );
        expect(result.data.accessToken).toBe('mock-access-token');
        expect(result.data.refreshToken).toBeDefined();
        expect(result.data.isVerified).toBe(true);
    });
});