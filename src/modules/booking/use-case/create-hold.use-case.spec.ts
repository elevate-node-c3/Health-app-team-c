import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { CreateHoldUseCase } from './create-hold.use-case';
import { DoctorClinicEntity } from '../../catalog/entities/doctor-clinic.entity';
import { AppointmentEntity } from '../../catalog/entities/appointment.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { SlotHoldEntity } from '../entities/slot-hold.entity';

function futureDate(daysAhead = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

describe('CreateHoldUseCase', () => {
  let useCase: CreateHoldUseCase;
  let doctorClinicRepo: any;
  let appointmentRepo: any;
  let outboxProcessor: any;

  const pairing: any = {
    isActive: true,
    consultationFee: '200.00',
    doctor: { isActive: true, isVerified: true },
    clinic: { isActive: true },
    schedule: {
      Mon: { start: '09:00', end: '17:00' },
      Tue: { start: '09:00', end: '17:00' },
      Wed: { start: '09:00', end: '17:00' },
      Thu: { start: '09:00', end: '17:00' },
      Fri: { start: '09:00', end: '17:00' },
      Sat: { start: '09:00', end: '17:00' },
      Sun: { start: '09:00', end: '17:00' },
      slotDuration: 30,
    },
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      create: jest.fn().mockImplementation((cls: any, dto: any) => ({ id: cls === OutboxEventEntity ? 'event-1' : 'hold-1', ...dto })),
      save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
    },
  };

  beforeEach(async () => {
    doctorClinicRepo = { findOne: jest.fn().mockResolvedValue(pairing) };
    appointmentRepo = { findOne: jest.fn().mockResolvedValue(null) };
    outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) };
    mockQueryRunner.manager.save.mockClear();
    mockQueryRunner.manager.create.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateHoldUseCase,
        { provide: getRepositoryToken(DoctorClinicEntity), useValue: doctorClinicRepo },
        { provide: getRepositoryToken(AppointmentEntity), useValue: appointmentRepo },
        { provide: DataSource, useValue: { createQueryRunner: () => mockQueryRunner } },
        { provide: OutboxProcessorService, useValue: outboxProcessor },
      ],
    }).compile();

    useCase = module.get(CreateHoldUseCase);
  });

  it('creates hold with frozen fee + slot.held event', async () => {
    const dto: any = { doctorId: 'd1', clinicId: 'c1', date: futureDate(), startTime: '10:00' };
    const result = await useCase.execute('patient-1', dto);
    await new Promise((r) => setImmediate(r));
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(outboxProcessor.triggerPublish).toHaveBeenCalledWith('event-1');
    expect(result.data.frozenFee).toBe('200');
    expect(result.data.holdId).toBe('hold-1');
  });

  it('409 when appointment already booked', async () => {
    appointmentRepo.findOne.mockResolvedValueOnce({ status: 'BOOKED' });
    const dto: any = { doctorId: 'd1', clinicId: 'c1', date: futureDate(), startTime: '10:00' };
    await expect(useCase.execute('patient-1', dto)).rejects.toThrow(ConflictException);
  });

  it('409 on concurrent race (23505)', async () => {
    mockQueryRunner.manager.save.mockRejectedValueOnce({ code: '23505' });
    const dto: any = { doctorId: 'd1', clinicId: 'c1', date: futureDate(), startTime: '10:30' };
    await expect(useCase.execute('patient-1', dto)).rejects.toThrow(ConflictException);
  });
});
