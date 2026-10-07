import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { SignupUseCase } from './signup.use-case';
import { UserEntity, UserStatus } from '../entities/user.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { MigrateGuestConversationsUseCase } from '../../ai-assistant/use-cases/migrate-guest-conversations.use-case';

describe('SignupUseCase', () => {
    let useCase: SignupUseCase;
    let userRepository: Partial<Repository<UserEntity>>;
    let dataSource: Partial<DataSource>;
    let outboxProcessorService: Partial<OutboxProcessorService>;
    let migrateGuestConversationsUseCase: Partial<MigrateGuestConversationsUseCase>;

    const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
            save: jest.fn().mockImplementation((entity) => {
                if (!entity.id) {
                    entity.id = entity instanceof OutboxEventEntity ? `outbox-id-${Math.random()}` : 'user-id-123';
                }
                return Promise.resolve(entity);
            }),
            create: jest.fn().mockImplementation((entityClass, dto) => {
                return { ...dto };
            }),
        },
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        userRepository = {
            findOne: jest.fn(),
        };

        dataSource = {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        };

        outboxProcessorService = {
            triggerPublish: jest.fn().mockResolvedValue(undefined),
        };

        migrateGuestConversationsUseCase = {
            execute: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SignupUseCase,
                {
                    provide: getRepositoryToken(UserEntity),
                    useValue: userRepository,
                },
                {
                    provide: DataSource,
                    useValue: dataSource,
                },
                {
                    provide: OutboxProcessorService,
                    useValue: outboxProcessorService,
                },
                {
                    provide: MigrateGuestConversationsUseCase,
                    useValue: migrateGuestConversationsUseCase,
                },
            ],
        }).compile();

        useCase = module.get<SignupUseCase>(SignupUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw BadRequestException if passwords do not match', async () => {
        const dto: any = {
            password: 'Password123!',
            confirmPassword: 'DifferentPassword!',
        };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if email or phone is already registered and verified', async () => {
        const verifiedUser = { isVerified: true } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValueOnce(verifiedUser);

        const dto: any = {
            password: 'Password123!',
            confirmPassword: 'Password123!',
            email: 'test@example.com',
            phoneNumber: '01012345678',
        };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should successfully register a new user and trigger outbox event', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

        const dto: any = {
            fullName: 'Test User',
            email: 'test@example.com',
            phoneNumber: '01012345678',
            gender: 'MALE',
            password: 'Password123!',
            confirmPassword: 'Password123!',
        };

        const result = await useCase.execute(dto);

        await new Promise((resolve) => setImmediate(resolve));

        expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
        expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
        expect(outboxProcessorService.triggerPublish).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            message: expect.stringContaining('Registration successful'),
            statusCode: 201,
            data: {
                userId: 'user-id-123',
                email: 'test@example.com',
                fullName: 'Test User',
                phone: '+201012345678',
                status: UserStatus.UNVERIFIED_PATIENT,
                isVerified: false,
            },
        });
    });

    it('should migrate conversations and publish guest.promoted event when guestDeviceId is provided', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

        const dto: any = {
            fullName: 'Guest User',
            email: 'guest@example.com',
            phoneNumber: '01012345678',
            gender: 'MALE',
            password: 'Password123!',
            confirmPassword: 'Password123!',
            bookingIntent: { doctorId: 'doc-123' },
        };

        const guestDeviceId = 'guest-device-xyz';

        const result = await useCase.execute(dto, guestDeviceId);

        await new Promise((resolve) => setImmediate(resolve));

        expect(migrateGuestConversationsUseCase.execute).toHaveBeenCalledWith(
            guestDeviceId,
            'user-id-123',
        );
        expect(outboxProcessorService.triggerPublish).toHaveBeenCalledTimes(2);
        expect(result.data.pendingBookingIntent).toEqual({ doctorId: 'doc-123' });
    });
});