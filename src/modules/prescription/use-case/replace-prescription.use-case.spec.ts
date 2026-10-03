import { DataSource } from 'typeorm';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { ReplacePrescriptionUseCase } from './replace-prescription.use-case';

describe('ReplacePrescriptionUseCase', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let useCase: ReplacePrescriptionUseCase;
  let storage: { save: jest.Mock; read: jest.Mock; delete: jest.Mock };
  let appointment: Record<string, unknown>;
  let storedRow: Record<string, unknown> | null;

  beforeEach(() => {
    appointment = {
      id: appointmentId,
      patientId: '22222222-2222-4222-8222-222222222222',
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
    };
    storedRow = { id: 'prescription-1', appointmentId, storageKey: `${appointmentId}/old.pdf` };
    storage = { save: jest.fn().mockResolvedValue(undefined), read: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) };

    const appointmentQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(appointment)),
    };
    const prescriptionQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(storedRow)),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === OutboxEventEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'event-1' })) };
        }
        if (entity === PrescriptionEntity) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue(prescriptionQb),
            save: jest.fn().mockImplementation((row) => Promise.resolve(row)),
          };
        }
        return { createQueryBuilder: jest.fn().mockReturnValue(appointmentQb) };
      }),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) } as unknown as DataSource;
    const outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) } as never;

    useCase = new ReplacePrescriptionUseCase(dataSource, storage as never, outboxProcessor);
  });

  it('replaces bytes, stamps audit, emits a new event, and deletes the old file after commit', async () => {
    const result = await useCase.execute(appointmentId, pngBuffer, adminId);

    expect(result.mimeType).toBe('image/png');
    expect(result.replacedBy).toBe(adminId);
    expect(result.replacedAt).toBeInstanceOf(Date);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(`${appointmentId}/old.pdf`);
  });

  it('refuses replace when no prescription exists', async () => {
    storedRow = null;

    await expect(useCase.execute(appointmentId, pngBuffer, adminId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_NOT_FOUND' },
    });
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('refuses replace for a non-completed appointment and cleans the new file', async () => {
    appointment.status = AppointmentStatus.BOOKED;

    await expect(useCase.execute(appointmentId, pngBuffer, adminId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_NOT_COMPLETED' },
    });
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});
