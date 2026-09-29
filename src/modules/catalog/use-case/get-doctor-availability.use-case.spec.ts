import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GetDoctorAvailabilityUseCase } from './get-doctor-availability.use-case';
import { DoctorClinicEntity } from '../entities/doctor-clinic.entity';
import { AppointmentEntity, AppointmentStatus } from '../entities/appointment.entity';
import { SlotHoldEntity } from '../../booking/entities/slot-hold.entity';

describe('GetDoctorAvailabilityUseCase', () => {
    let useCase: GetDoctorAvailabilityUseCase;
    let doctorClinicRepoMock: any;
    let appointmentRepoMock: any;
    let holdRepoMock: any;

    beforeEach(async () => {
        doctorClinicRepoMock = {
            findOne: jest.fn(),
        };
        appointmentRepoMock = {
            find: jest.fn(),
        };
        holdRepoMock = {
            find: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GetDoctorAvailabilityUseCase,
                { provide: getRepositoryToken(DoctorClinicEntity), useValue: doctorClinicRepoMock },
                { provide: getRepositoryToken(AppointmentEntity), useValue: appointmentRepoMock },
                { provide: getRepositoryToken(SlotHoldEntity), useValue: holdRepoMock },
            ],
        }).compile();

        useCase = module.get<GetDoctorAvailabilityUseCase>(GetDoctorAvailabilityUseCase);
    });

    it('should be defined', () => {
        expect(useCase).toBeDefined();
    });

    it('should throw NotFoundException if pairing is not active', async () => {
        doctorClinicRepoMock.findOne.mockResolvedValue(null);
        await expect(useCase.execute({ doctorId: 'doc-1', clinicId: 'clinic-1', date: '2050-01-01' }))
            .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for past dates', async () => {
        doctorClinicRepoMock.findOne.mockResolvedValue({
            isActive: true,
            doctor: { isActive: true, isVerified: true },
            clinic: { isActive: true },
        });
        
        await expect(useCase.execute({ doctorId: 'doc-1', clinicId: 'clinic-1', date: '2000-01-01' }))
            .rejects.toThrow(BadRequestException);
    });

    it('should return slots grouped by time of day', async () => {
        const cairoTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const now = new Date(cairoTime);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        const dayTokens = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const targetDay = dayTokens[tomorrow.getDay()];

        doctorClinicRepoMock.findOne.mockResolvedValue({
            isActive: true,
            consultationFee: 200,
            doctor: { isActive: true, isVerified: true },
            clinic: { isActive: true },
            schedule: {
                [targetDay]: { start: '10:00', end: '13:00' }, // 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 13:00
                slotDuration: 30,
            }
        });

        appointmentRepoMock.find.mockResolvedValue([
            { startTime: '11:00:00', status: AppointmentStatus.BOOKED } // One booked slot
        ]);

        const result = await useCase.execute({ doctorId: 'doc-1', clinicId: 'clinic-1', date: tomorrowStr });

        expect(result.success).toBe(true);
        expect(result.data.consultationFee).toBe(200);
        
        // 10:00, 10:30, 11:00, 11:30 are Morning
        // 12:00, 12:30 are Afternoon
        expect(result.data.slots.Morning).toHaveLength(4);
        expect(result.data.slots.Afternoon).toHaveLength(2);
        
        const bookedSlot = result.data.slots.Morning.find(s => s.time === '11:00');
        expect(bookedSlot!.status).toBe('TAKEN');
        
        const freeSlot = result.data.slots.Morning.find(s => s.time === '10:00');
        expect(freeSlot!.status).toBe('AVAILABLE');
    });

    it('should mark actively held slots as TAKEN', async () => {
        const cairoTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const now = new Date(cairoTime);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        const dayTokens = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const targetDay = dayTokens[tomorrow.getDay()];

        doctorClinicRepoMock.findOne.mockResolvedValue({
            isActive: true,
            consultationFee: 200,
            doctor: { isActive: true, isVerified: true },
            clinic: { isActive: true },
            schedule: {
                [targetDay]: { start: '10:00', end: '11:00' },
                slotDuration: 30,
            }
        });

        appointmentRepoMock.find.mockResolvedValue([]);
        holdRepoMock.find.mockResolvedValue([
            { startTime: '10:00:00', expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
        ]);

        const result = await useCase.execute({ doctorId: 'doc-1', clinicId: 'clinic-1', date: tomorrowStr });

        const heldSlot = result.data.slots.Morning.find(s => s.time === '10:00');
        expect(heldSlot!.status).toBe('TAKEN');
    });
});
