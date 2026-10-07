import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AiQuotaService, AI_COST_LIMITS } from './ai-quota.service';
import { RedisService } from 'src/common/redis/redis.service';
import { UserContext } from 'src/common/middleware/auth-context.middleware';

describe('AiQuotaService', () => {
    let service: AiQuotaService;
    let redisService: jest.Mocked<RedisService>;
    let amqpConnection: jest.Mocked<AmqpConnection>;

    const mockUserCtx: UserContext = {
        userId: 'user-123',
        role: 'PATIENT',
    } as unknown as UserContext;

    const mockGuestCtx: UserContext = {
        deviceId: 'device-456',
        role: 'GUEST',
    } as unknown as UserContext;

    beforeEach(async () => {
        const mockRedis = {
            get: jest.fn(),
            setNx: jest.fn(),
            incr: jest.fn(),
        };

        const mockAmqp = {
            publish: jest.fn().mockResolvedValue(true),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiQuotaService,
                { provide: RedisService, useValue: mockRedis },
                { provide: AmqpConnection, useValue: mockAmqp },
            ],
        }).compile();

        service = module.get<AiQuotaService>(AiQuotaService);
        redisService = module.get(RedisService);
        amqpConnection = module.get(AmqpConnection);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Identity validation', () => {
        it('should throw 403 FORBIDDEN when userContext lacks both userId and deviceId', async () => {
            const invalidCtx = { role: 'GUEST' } as unknown as UserContext;

            await expect(service.consume(invalidCtx)).rejects.toMatchObject({
                status: HttpStatus.FORBIDDEN,
                response: {
                    code: 'AUTH_IDENTITY_MISSING',
                    messageKey: 'errors.auth.identity_missing',
                },
            });
        });
    });

    describe('Heavy Spender Protection (Monthly Spend)', () => {
        it('should throw 429 when patient reaches monthly spend limit', async () => {
            redisService.get.mockResolvedValueOnce(
                AI_COST_LIMITS.MAX_PATIENT_MONTHLY_SPEND_USD,
            );

            await expect(service.consume(mockUserCtx)).rejects.toMatchObject({
                status: HttpStatus.TOO_MANY_REQUESTS,
                response: {
                    code: 'AI_PATIENT_SPEND_LIMIT_EXCEEDED',
                    messageKey: 'errors.ai.patient_spend_limit_reached',
                },
            });

            expect(redisService.get).toHaveBeenCalledWith(
                expect.stringMatching(/^ai_spend:patient:user-123:\d{4}-\d{2}$/),
            );
            expect(redisService.incr).not.toHaveBeenCalled();
        });

        it('should bypass heavy spender check for guest users', async () => {
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(1);

            await expect(service.consume(mockGuestCtx)).resolves.not.toThrow();

            expect(redisService.get).not.toHaveBeenCalled();
        });
    });

    describe('Daily Message Quota', () => {
        it('should allow valid user request when within 50 daily limit', async () => {
            redisService.get.mockResolvedValueOnce(0);
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(25);

            await expect(service.consume(mockUserCtx)).resolves.not.toThrow();

            expect(redisService.setNx).toHaveBeenCalledWith(
                expect.stringMatching(/^ai_limit:user:user-123:\d{4}-\d{2}-\d{2}$/),
                '0',
                expect.any(Number),
            );
            expect(redisService.incr).toHaveBeenCalled();
            expect(amqpConnection.publish).not.toHaveBeenCalled();
        });

        it('should throw 429 and publish RabbitMQ event when user exceeds 50 limit', async () => {
            redisService.get.mockResolvedValueOnce(0);
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(51);

            let thrownError: any;
            try {
                await service.consume(mockUserCtx);
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(HttpException);
            expect(thrownError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
            expect(thrownError.getResponse()).toMatchObject({
                code: 'AI_RATE_LIMIT_EXCEEDED',
                messageKey: 'errors.ai.user_limit_reached',
                details: {
                    limit: 50,
                    canUpgradeRole: false,
                },
            });

            expect(amqpConnection.publish).toHaveBeenCalledWith(
                'ai_exchange',
                'AI_USAGE_LIMIT_REACHED',
                expect.objectContaining({
                    identifierId: 'user-123',
                    patientId: 'user-123',
                    deviceId: null,
                    isGuest: false,
                    limit: 50,
                }),
            );
        });

        it('should throw 429 and publish event with canUpgradeRole=true when guest exceeds 10 limit', async () => {
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(11);

            let thrownError: any;
            try {
                await service.consume(mockGuestCtx);
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(HttpException);
            expect(thrownError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
            expect(thrownError.getResponse()).toMatchObject({
                code: 'AI_RATE_LIMIT_EXCEEDED',
                messageKey: 'errors.ai.guest_limit_reached',
                details: {
                    limit: 10,
                    canUpgradeRole: true,
                },
            });

            expect(amqpConnection.publish).toHaveBeenCalledWith(
                'ai_exchange',
                'AI_USAGE_LIMIT_REACHED',
                expect.objectContaining({
                    identifierId: 'device-456',
                    patientId: null,
                    deviceId: 'device-456',
                    isGuest: true,
                    limit: 10,
                }),
            );
        });

        it('should still throw 429 even if RabbitMQ publish fails', async () => {
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(11);
            amqpConnection.publish.mockRejectedValueOnce(new Error('Broker unreachable'));

            await expect(service.consume(mockGuestCtx)).rejects.toMatchObject({
                status: HttpStatus.TOO_MANY_REQUESTS,
            });
        });
    });

    describe('Error Resilience', () => {
        it('should throw ServiceUnavailableException (503) when Redis fails during daily limit check', async () => {
            redisService.get.mockResolvedValueOnce(0);
            redisService.setNx.mockRejectedValueOnce(new Error('Redis connection refused'));

            await expect(service.consume(mockUserCtx)).rejects.toThrow(
                ServiceUnavailableException,
            );
        });

        it('should rethrow original HttpException if thrown inside the try-catch block', async () => {
            redisService.setNx.mockResolvedValueOnce(true as any);
            redisService.incr.mockResolvedValueOnce(11);

            await expect(service.consume(mockGuestCtx)).rejects.toThrow(HttpException);
        });
    });
});