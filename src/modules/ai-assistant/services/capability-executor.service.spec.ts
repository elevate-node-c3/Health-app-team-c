import { Test, TestingModule } from '@nestjs/testing';
import { CapabilityExecutorService } from './capability-executor.service';
import { AiCapabilitiesService } from '../capabilities/ai-capabilities.service';
import { ToolSession } from '../capabilities/tool-session';
import { TOOL } from '../config/ai-tools.config';

describe('CapabilityExecutorService', () => {
    let service: CapabilityExecutorService;
    let capabilities: jest.Mocked<AiCapabilitiesService>;

    const mockSession: ToolSession = {
        userId: 'user-123',
        deviceId: 'device-456',
        isGuest: false,
    } as unknown as ToolSession;

    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    beforeEach(async () => {
        const mockCapabilitiesService = {
            listSpecialties: jest.fn(),
            suggestSpecialty: jest.fn(),
            searchDoctors: jest.fn(),
            getAvailability: jest.fn(),
            getMyAppointments: jest.fn(),
            getPolicy: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CapabilityExecutorService,
                { provide: AiCapabilitiesService, useValue: mockCapabilitiesService },
            ],
        }).compile();

        service = module.get<CapabilityExecutorService>(CapabilityExecutorService);
        capabilities = module.get(AiCapabilitiesService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Happy Paths (Tool Dispatch)', () => {
        it(`should dispatch ${TOOL.LIST_SPECIALTIES} successfully`, async () => {
            const mockResult = { specialties: ['Cardiology', 'Dermatology'] };
            capabilities.listSpecialties.mockResolvedValueOnce(mockResult as any);

            const result = await service.executeTool(TOOL.LIST_SPECIALTIES, {}, mockSession);

            expect(capabilities.listSpecialties).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockResult);
        });

        it(`should dispatch ${TOOL.SUGGEST_SPECIALTY} with sanitized arguments`, async () => {
            const mockResult = { ok: true, specialty: 'Cardiology' };
            capabilities.suggestSpecialty.mockResolvedValueOnce(mockResult as any);

            const rawArgs = { specialty: 'Cardiology', maliciousField: 'ignore_me' };
            const result = await service.executeTool(TOOL.SUGGEST_SPECIALTY, rawArgs, mockSession);

            expect(capabilities.suggestSpecialty).toHaveBeenCalledWith(
                { specialty: 'Cardiology' },
                mockSession,
            );
            expect(result).toEqual(mockResult);
        });

        it(`should dispatch ${TOOL.SEARCH_DOCTORS} with optional strings`, async () => {
            const mockResult = { doctors: [{ id: validUuid, name: 'Dr. John' }] };
            capabilities.searchDoctors.mockResolvedValueOnce(mockResult as any);

            const rawArgs = { specialty: 'Cardiology', name: 'John' };
            const result = await service.executeTool(TOOL.SEARCH_DOCTORS, rawArgs, mockSession);

            expect(capabilities.searchDoctors).toHaveBeenCalledWith(
                { specialty: 'Cardiology', name: 'John' },
                mockSession,
            );
            expect(result).toEqual(mockResult);
        });

        it(`should dispatch ${TOOL.GET_AVAILABILITY} with valid UUID`, async () => {
            const mockResult = { found: true, freeSlots: ['2026-10-10T10:00:00Z'] };
            capabilities.getAvailability.mockResolvedValueOnce(mockResult as any);

            const rawArgs = { doctorId: validUuid };
            const result = await service.executeTool(TOOL.GET_AVAILABILITY, rawArgs, mockSession);

            expect(capabilities.getAvailability).toHaveBeenCalledWith(
                { doctorId: validUuid },
                mockSession,
            );
            expect(result).toEqual(mockResult);
        });

        it(`should dispatch ${TOOL.GET_MY_APPOINTMENTS} ignoring injected args and relying solely on session`, async () => {
            const mockResult = { appointments: [] };
            capabilities.getMyAppointments.mockResolvedValueOnce(mockResult as any);

            const maliciousArgs = { patientId: 'injected-user-id' };
            const result = await service.executeTool(
                TOOL.GET_MY_APPOINTMENTS,
                maliciousArgs,
                mockSession,
            );

            expect(capabilities.getMyAppointments).toHaveBeenCalledWith(mockSession);
            expect(result).toEqual(mockResult);
        });

        it(`should dispatch ${TOOL.GET_POLICY} with required topic`, async () => {
            const mockResult = { found: true, content: 'Cancellation policy details' };
            capabilities.getPolicy.mockReturnValueOnce(mockResult as any);

            const rawArgs = { topic: 'cancellation' };
            const result = await service.executeTool(TOOL.GET_POLICY, rawArgs, mockSession);

            expect(capabilities.getPolicy).toHaveBeenCalledWith({ topic: 'cancellation' });
            expect(result).toEqual(mockResult);
        });
    });

    describe('Validation & ToolArgsError', () => {
        it('should return INVALID_ARGUMENTS when requiredString is missing or invalid', async () => {
            const rawArgs = {};

            const result = (await service.executeTool(
                TOOL.SUGGEST_SPECIALTY,
                rawArgs,
                mockSession,
            )) as Record<string, unknown>;

            expect(result).toEqual({
                error: 'INVALID_ARGUMENTS',
                field: 'specialty',
            });
            expect(capabilities.suggestSpecialty).not.toHaveBeenCalled();
        });

        it('should return INVALID_ARGUMENTS when UUID format is invalid', async () => {
            const rawArgs = { doctorId: 'not-a-valid-uuid' };

            const result = (await service.executeTool(
                TOOL.GET_AVAILABILITY,
                rawArgs,
                mockSession,
            )) as Record<string, unknown>;

            expect(result).toEqual({
                error: 'INVALID_ARGUMENTS',
                field: 'doctorId',
            });
            expect(capabilities.getAvailability).not.toHaveBeenCalled();
        });

        it('should handle non-object rawArgs gracefully by parsing as empty object', async () => {
            const result = (await service.executeTool(
                TOOL.GET_POLICY,
                'invalid-json-string',
                mockSession,
            )) as Record<string, unknown>;

            expect(result).toEqual({
                error: 'INVALID_ARGUMENTS',
                field: 'topic',
            });
        });
    });

    describe('Unknown Tools & System Failures', () => {
        it('should return UNKNOWN_TOOL for unrecognized tool name', async () => {
            const result = await service.executeTool('delete_database', {}, mockSession);

            expect(result).toEqual({ error: 'UNKNOWN_TOOL' });
        });

        it('should catch unexpected errors and return TEMPORARILY_UNAVAILABLE', async () => {
            capabilities.listSpecialties.mockRejectedValueOnce(
                new Error('Database connection failed'),
            );

            const result = await service.executeTool(TOOL.LIST_SPECIALTIES, {}, mockSession);

            expect(result).toEqual({ error: 'TEMPORARILY_UNAVAILABLE' });
        });
    });

    describe('Summarize helper logging checks', () => {
        it('should handle summary states cleanly for various responses', async () => {
            const errRes = await service.executeTool(TOOL.GET_AVAILABILITY, {}, mockSession);
            expect(errRes).toHaveProperty('error', 'INVALID_ARGUMENTS');

            capabilities.searchDoctors.mockResolvedValueOnce({ doctors: [{}, {}] } as any);
            const docRes = await service.executeTool(TOOL.SEARCH_DOCTORS, {}, mockSession);
            expect(docRes).toHaveProperty('doctors');

            const unkRes = await service.executeTool('unknown', null, mockSession);
            expect(unkRes).toEqual({ error: 'UNKNOWN_TOOL' });
        });
    });
});