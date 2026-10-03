import { DataSource } from 'typeorm';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { AttachPrescriptionUseCase } from './attach-prescription.use-case';

describe('AttachPrescriptionUseCase', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  let useCase: AttachPrescriptionUseCase;
  let storage: { save: jest.Mock; read: jest.Mock; delete: jest.Mock };
  let existingCheck: { findOne: jest.Mock };
  let appointment: Record<string, unknown>;
  let failTransactionWith: unknown;

  beforeEach(() => {
    appointment = {
      id: appointmentId,
      patientId: '22222222-2222-4222-8222-222222222222',
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
    };
    failTransactionWith = null;
    storage = { save: jest.fn().mockResolvedValue(undefined), read: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) };
    existingCheck = { findOne: jest.fn().mockResolvedValue(null) };

    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(appointment)),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === OutboxEventEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'event-1' })) };
        }
        if (entity === PrescriptionEntity) {
          return {
            save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'prescription-1' })),
          };
        }
        return { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
      }),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => {
        if (failTransactionWith) return Promise.reject(failTransactionWith);
        return cb(manager);
      }),
    } as unknown as DataSource;
    const outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) } as never;

    useCase = new AttachPrescriptionUseCase(dataSource, storage as never, outboxProcessor, existingCheck as never);
  });

  it('attaches a prescription for a COMPLETED appointment with audit fields', async () => {
    const result = await useCase.execute(appointmentId, pdfBuffer, adminId);

    expect(result.appointmentId).toBe(appointmentId);
    expect(result.uploadedBy).toBe(adminId);
    expect(result.uploadedAt).toBeInstanceOf(Date);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it.each([AppointmentStatus.BOOKED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW])(
    'refuses %s with PRESCRIPTION_NOT_COMPLETED and cleans the orphan file',
    async (status) => {
      appointment.status = status;

      await expect(useCase.execute(appointmentId, pdfBuffer, adminId)).rejects.toMatchObject({
        response: { code: 'PRESCRIPTION_NOT_COMPLETED' },
      });
      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a duplicate POST with 409 before touching storage', async () => {
    existingCheck.findOne.mockResolvedValue({ id: 'prescription-1', appointmentId });

    await expect(useCase.execute(appointmentId, pdfBuffer, adminId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_ALREADY_EXISTS' },
    });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('maps a 23505 race to 409 and deletes the orphan file', async () => {
    failTransactionWith = { code: '23505' };

    await expect(useCase.execute(appointmentId, pdfBuffer, adminId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_ALREADY_EXISTS' },
    });
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the orphan file when the transaction fails for another reason', async () => {
    failTransactionWith = new Error('db down');

    await expect(useCase.execute(appointmentId, pdfBuffer, adminId)).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('refuses a renamed non-PDF with PRESCRIPTION_INVALID_TYPE', async () => {
    await expect(
      useCase.execute(appointmentId, Buffer.from('plain text, not a pdf'), adminId),
    ).rejects.toMatchObject({ response: { code: 'PRESCRIPTION_INVALID_TYPE' } });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('refuses an oversize file with PRESCRIPTION_TOO_LARGE', async () => {
    process.env.PRESCRIPTION_MAX_BYTES = '10';
    try {
      const big = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.alloc(11, 0x41)]);
      await expect(useCase.execute(appointmentId, big, adminId)).rejects.toMatchObject({
        response: { code: 'PRESCRIPTION_TOO_LARGE' },
      });
      expect(storage.save).not.toHaveBeenCalled();
    } finally {
      delete process.env.PRESCRIPTION_MAX_BYTES;
    }
  });
});
