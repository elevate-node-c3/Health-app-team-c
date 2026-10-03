import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReminderNotificationConsumer } from './reminder-notification.consumer';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { AppointmentMailService } from 'src/common/mail/appointment-mail.service';
import { UserEntity } from 'src/modules/auth/entities/user.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { ClinicEntity } from 'src/modules/catalog/entities/clinic.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { Nack } from '@golevelup/nestjs-rabbitmq';

describe('ReminderNotificationConsumer', () => {
  let consumer: ReminderNotificationConsumer;
  let processed: { findOne: jest.Mock; insert: jest.Mock };
  let mail: { sendBookingConfirmation: jest.Mock };
  let users: { findOne: jest.Mock };
  let notifications: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let doctors: { findOne: jest.Mock };
  let clinics: { findOne: jest.Mock };

  const msg = {
    appointmentId: 'a1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    clinicId: 'clinic-1',
    date: '2026-10-02',
    startTime: '10:00:00',
    reminderId: 'r1',
  };
  const amqpMsg = { properties: { headers: { 'x-event-id': 'evt-1' } } } as never;

  beforeEach(async () => {
    processed = { findOne: jest.fn().mockResolvedValue(null), insert: jest.fn().mockResolvedValue(undefined) };
    mail = { sendBookingConfirmation: jest.fn().mockResolvedValue(undefined) };
    users = { findOne: jest.fn().mockResolvedValue({ id: 'patient-1', email: 'patient@example.com' }) };
    doctors = { findOne: jest.fn().mockResolvedValue({ fullName: 'Dr Ahmed' }) };
    clinics = { findOne: jest.fn().mockResolvedValue({ name: 'Maadi Clinic' }) };
    notifications = {
      create: jest.fn((dto: object) => dto),
      save: jest.fn(async (e: object) => e),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderNotificationConsumer,
        { provide: AppointmentMailService, useValue: mail },
        { provide: getRepositoryToken(ProcessedEventEntity), useValue: processed },
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: getRepositoryToken(DoctorEntity), useValue: doctors },
        { provide: getRepositoryToken(ClinicEntity), useValue: clinics },
        { provide: getRepositoryToken(NotificationEntity), useValue: notifications },
      ],
    }).compile();

    consumer = module.get(ReminderNotificationConsumer);
  });

  it('delivers once and writes owning-patient notification', async () => {
    await consumer.handleReminderDue(msg, amqpMsg);
    expect(mail.sendBookingConfirmation).toHaveBeenCalledTimes(1);
    expect(notifications.save).toHaveBeenCalledTimes(1);
    expect(notifications.save.mock.calls[0][0]).toMatchObject({ userId: 'patient-1' });
    expect(processed.insert).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1:reminder-email' }),
    );
  });

  it('duplicate delivery sends nothing twice', async () => {
    await consumer.handleReminderDue(msg, amqpMsg);
    processed.findOne.mockResolvedValue({ eventId: 'evt-1:reminder-email' });
    mail.sendBookingConfirmation.mockClear();
    notifications.save.mockClear();
    await consumer.handleReminderDue(msg, amqpMsg);
    expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('missing user nacks without sending', async () => {
    users.findOne.mockResolvedValue(null);
    const result = await consumer.handleReminderDue(msg, amqpMsg);
    expect(result).toBeInstanceOf(Nack);
    expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
  });
});
