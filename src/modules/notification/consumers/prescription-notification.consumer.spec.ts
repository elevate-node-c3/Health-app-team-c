import { Nack } from '@golevelup/nestjs-rabbitmq';
import { PrescriptionNotificationConsumer } from './prescription-notification.consumer';

describe('PrescriptionNotificationConsumer (ENG-6 Task 3)', () => {
  const payload = {
    prescriptionId: '66666666-6666-4666-8666-666666666666',
    appointmentId: '11111111-1111-4111-8111-111111111111',
    patientId: '22222222-2222-4222-8222-222222222222',
    doctorId: '44444444-4444-4444-8444-444444444444',
    clinicId: '55555555-5555-4555-8555-555555555555',
    issuedAt: new Date().toISOString(),
    issuedBy: '33333333-3333-4333-8333-333333333333',
  };
  const amqpMsg = (eventId?: string) =>
    ({ properties: { headers: eventId ? { 'x-event-id': eventId } : {} } }) as never;

  let consumer: PrescriptionNotificationConsumer;
  let sendNotification: { execute: jest.Mock };
  let processed: { insert: jest.Mock };

  beforeEach(() => {
    sendNotification = { execute: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    processed = { insert: jest.fn().mockResolvedValue({}) };
    consumer = new PrescriptionNotificationConsumer(sendNotification as never, processed as never);
  });

  it('creates exactly one inbox entry for one PRESCRIPTION_ISSUED delivery', async () => {
    await consumer.handleIssued(payload, amqpMsg('evt-1'));

    expect(processed.insert).toHaveBeenCalledWith({ eventId: 'evt-1', eventType: 'PRESCRIPTION_ISSUED' });
    expect(sendNotification.execute).toHaveBeenCalledTimes(1);
    expect(sendNotification.execute).toHaveBeenCalledWith({
      userId: payload.patientId,
      title: 'Prescription ready',
      message: 'Your prescription is ready for download',
    });
  });

  it('a duplicate delivery creates no second inbox entry', async () => {
    processed.insert.mockRejectedValueOnce({ code: '23505' });

    await consumer.handleIssued(payload, amqpMsg('evt-1'));

    expect(sendNotification.execute).not.toHaveBeenCalled();
  });

  it('a transient claim failure dead-letters instead of silently skipping', async () => {
    processed.insert.mockRejectedValueOnce(new Error('claim db down'));

    const result = await consumer.handleIssued(payload, amqpMsg('evt-2'));

    expect(result).toBeInstanceOf(Nack);
    expect(sendNotification.execute).not.toHaveBeenCalled();
  });

  it('a consumer failure dead-letters without touching the prescription', async () => {
    sendNotification.execute.mockRejectedValueOnce(new Error('inbox db down'));

    const result = await consumer.handleIssued(payload, amqpMsg('evt-2'));

    expect(result).toBeInstanceOf(Nack);
    expect((consumer as unknown as { storage?: unknown }).storage).toBeUndefined();
  });

  it('never throws into the producer', async () => {
    sendNotification.execute.mockRejectedValueOnce(new Error('boom'));
    await expect(consumer.handleIssued(payload, amqpMsg('evt-3'))).resolves.toBeDefined();

    await expect(consumer.handleDeadLetter(payload, amqpMsg('evt-3'))).resolves.toBeUndefined();
  });
});
