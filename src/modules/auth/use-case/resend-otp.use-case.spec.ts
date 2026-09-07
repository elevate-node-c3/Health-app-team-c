import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ResendOtpUseCase } from './resend-otp.use-case';
import { UserEntity } from '../entities/user.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';

describe('ResendOtpUseCase', () => {
    let useCase: ResendOtpUseCase;
    let userRepository: Partial<Repository<UserEntity>>;
    let dataSource: Partial<DataSource>;
    let outboxProcessorService: Partial<OutboxProcessorService>;

    const mockManager = {
        save: jest.fn().mockImplementation((entity) => {
            if (entity instanceof UserEntity) {
                return Promise.resolve({ ...entity, id: 'user-id-123' });
            }
            return Promise.resolve({ id: 'outbox-id-123', ...entity });
        }),
        create: jest.fn().mockImplementation((entityClass, dto) => {
            if (entityClass === OutboxEventEntity) {
                return { id: 'outbox-id-123', ...dto };
            }
            return dto;
        }),
    };

    beforeEach(async () => {
        userRepository = {
            findOne: jest.fn(),
        };

        dataSource = {
            transaction: jest.fn().mockImplementation(async (cb) => cb(mockManager)),
        };

        outboxProcessorService = {
            triggerPublish: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ResendOtpUseCase,
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
            ],
        }).compile();

        useCase = module.get<ResendOtpUseCase>(ResendOtpUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw NotFoundException if user does not exist', async () => {
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

        const dto: any = { email: 'notfound@example.com' };

        await expect(useCase.execute(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if account is already verified', async () => {
        const verifiedUser = { isVerified: true } as UserEntity;
        jest.spyOn(userRepository, 'findOne').mockResolvedValue(verifiedUser);

        const dto: any = { email: 'test@example.com' };

        await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    });

    it('should successfully resend OTP and trigger outbox event', async () => {
        const unverifiedUser = {
            id: 'user-id-123',
            email: 'test@example.com',
            isVerified: false,
        } as UserEntity;

        jest.spyOn(userRepository, 'findOne').mockResolvedValue(unverifiedUser);

        const dto: any = { email: 'test@example.com' };

        const result = await useCase.execute(dto);

        await new Promise((resolve) => setImmediate(resolve));

        expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
        expect(dataSource.transaction).toHaveBeenCalled();
        expect(outboxProcessorService.triggerPublish).toHaveBeenCalledWith('outbox-id-123');
        expect(result).toEqual({
            message: 'A new verification code has been sent to your email.',
        });
    });
});