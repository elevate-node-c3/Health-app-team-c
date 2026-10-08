import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from 'src/modules/prescription/entities/prescription.entity';
import { LocalPrescriptionStorageService } from 'src/modules/prescription/local-prescription-storage.service';
import { AttachPrescriptionUseCase } from 'src/modules/prescription/use-case/attach-prescription.use-case';
import { PrescriptionNotificationConsumer } from 'src/modules/notification/consumers/prescription-notification.consumer';
import { RefundEventsConsumer } from 'src/modules/notification/consumers/refund-notification.consumer';
import { AppointmentEventsConsumer } from 'src/modules/notification/consumers/appointment-notification.consumer';

jest.mock('src/modules/auth/auth.service', () => ({ AuthService: jest.fn() }));

function amqpMsg(eventId: string) {
  return { properties: { headers: { 'x-event-id': eventId } } } as never;
}

describe('Go-live verification (ENG-7 Task 4)', () => {
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
  const patientId = '22222222-2222-4222-8222-222222222222';
  let storageDir: string;
  let storage: LocalPrescriptionStorageService;

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'go-live-verify-'));
    process.env.PRESCRIPTION_STORAGE_PATH = storageDir;
    storage = new LocalPrescriptionStorageService();
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.PRESCRIPTION_STORAGE_PATH;
  });

  it('replays PRESCRIPTION_ISSUED twice with one inbox outcome', async () => {
    const sendNotification = { execute: jest.fn().mockResolvedValue({ id: 'n1' }) };
    const processed = {
      insert: jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ code: '23505' }),
    };
    const consumer = new PrescriptionNotificationConsumer(sendNotification as never, processed as never);
    const payload = {
      prescriptionId: 'p1',
      appointmentId: 'a1',
      patientId,
      doctorId: 'd1',
      clinicId: 'c1',
      issuedAt: new Date().toISOString(),
      issuedBy: 'admin1',
    };

    await consumer.handleIssued(payload, amqpMsg('evt-replay-1'));
    await consumer.handleIssued(payload, amqpMsg('evt-replay-1'));

    expect(processed.insert).toHaveBeenCalledTimes(2);
    expect(sendNotification.execute).toHaveBeenCalledTimes(1);
  });

  it('replays REFUND_ISSUED twice with one email outcome', async () => {
    const refundMailService = { sendRefundConfirmationEmail: jest.fn().mockResolvedValue(undefined) };
    const processedEvents = {
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ eventId: 'evt-replay-2:refund-email' }),
      insert: jest.fn().mockResolvedValue({}),
    };
    const userRepo = { findOne: jest.fn().mockResolvedValue({ id: 'u1', email: 'u1@docura.eg' }) };
    const consumer = new RefundEventsConsumer(refundMailService as never, processedEvents as never, userRepo as never);
    const payload = {
      refundId: 'r1',
      appointmentId: 'a1',
      userId: 'u1',
      amount: 300,
      providerRefundId: 'pr1',
      expectedArrivalAt: new Date().toISOString(),
    };

    await consumer.handleRefundIssued(payload, amqpMsg('evt-replay-2'));
    await consumer.handleRefundIssued(payload, amqpMsg('evt-replay-2'));

    expect(refundMailService.sendRefundConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('replays APPOINTMENT_BOOKED twice with one email outcome', async () => {
    const appointmentMailService = { sendBookingConfirmation: jest.fn().mockResolvedValue(undefined) };
    const processedEvents = {
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ eventId: 'evt-replay-3' }),
      insert: jest.fn().mockResolvedValue({}),
    };
    const userEntity = { findOne: jest.fn().mockResolvedValue({ id: 'u1', email: 'u1@docura.eg' }) };
    const doctorRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const clinicRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const consumer = new AppointmentEventsConsumer(
      appointmentMailService as never,
      {} as never,
      processedEvents as never,
      userEntity as never,
      doctorRepo as never,
      clinicRepo as never,
    );
    const payload = {
      userId: 'u1',
      holdId: 'h1',
      doctorId: 'd1',
      clinicId: 'c1',
      date: '2026-10-20',
      startTime: '10:00:00',
      endTime: '10:30:00',
      instructions: 'Please arrive 15 minutes before the appointment.',
    };

    await consumer.handleAppointmentBooked(payload, amqpMsg('evt-replay-3'));
    await consumer.handleAppointmentBooked(payload, amqpMsg('evt-replay-3'));

    expect(appointmentMailService.sendBookingConfirmation).toHaveBeenCalledTimes(1);
  });

  it('booking still succeeds when the notification path is down, leaving the outbox row pending', async () => {
    const appointmentId = '11111111-1111-4111-8111-111111111111';
    const completedAppointment = {
      id: appointmentId,
      patientId,
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
    };
    const capture: { saved: { isProcessed?: boolean; eventType: string } | null } = { saved: null };
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(completedAppointment),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === OutboxEventEntity) {
          return {
            save: jest.fn().mockImplementation((row) => {
              capture.saved = { ...row };
              return Promise.resolve({ ...row, id: 'evt-off-1' });
            }),
          };
        }
        if (entity === PrescriptionEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'presc-off-1' })) };
        }
        return { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
      }),
    };
    const dataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) };
    const outboxProcessor = { triggerPublish: jest.fn().mockRejectedValue(new Error('broker down')) };
    const useCase = new AttachPrescriptionUseCase(
      dataSource as never,
      storage,
      outboxProcessor as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
    );

    const prescription = await useCase.execute(appointmentId, pdfBuffer, 'admin1');

    expect(prescription.id).toBe('presc-off-1');
    expect(capture.saved).not.toBeNull();
    expect(capture.saved?.eventType).toBe('PRESCRIPTION_ISSUED');
    expect(capture.saved?.isProcessed ?? false).toBe(false);
  });
});
