import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEntity, Gender, UserStatus } from '../../modules/auth/entities/user.entity';
import { DoctorEntity, DoctorTitle, DoctorGender } from '../../modules/catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../../modules/catalog/entities/specialty.entity';
import { ClinicEntity, PlaceType } from '../../modules/catalog/entities/clinic.entity';
import { DoctorClinicEntity } from '../../modules/catalog/entities/doctor-clinic.entity';
import { AppointmentEntity, AppointmentStatus, CancellationOutcome } from '../../modules/catalog/entities/appointment.entity';
import { PaymentTransaction, PaymentStatus } from '../../modules/payment/entities/payment-transaction.entity';
import { RefundEntity, RefundStatus } from '../../modules/payment/entities/refund.entity';
import { PrescriptionEntity } from '../../modules/prescription/entities/prescription.entity';
import { LocalPrescriptionStorageService } from '../../modules/prescription/local-prescription-storage.service';
import { FavoriteEntity } from '../../modules/catalog/entities/favorite.entity';
import { NotificationEntity } from '../../modules/notification/entities/notification.entity';
import { AiConversationEntity } from '../../modules/ai-assistant/entities/ai-conversation.entity';
import { AiMessageEntity } from '../../modules/ai-assistant/entities/ai-message.entity';
import { AiMessageRole } from '../../modules/ai-assistant/enums/ai-message-role.enum';
import { AiMessageStatus } from '../../modules/ai-assistant/enums/ai-message-status.enum';
import { HashHelper } from '../../common/utils/hash.util';
import { RedisService } from '../../common/redis/redis.service';
import { CACHE_KEYS } from '../../common/constants/cache-keys.constant';

export const DEMO_PATIENT_EMAIL = 'demo@docura.eg';
export const DEMO_PATIENT_PHONE = '+201000000001';
export const DEMO_PASSWORD = 'Demo1234!';
export const DEMO_DOCTOR_NAME = 'Dr. Ahmed Hassan';
export const DEMO_CLINIC_NAME = 'Cairo Care Clinic';
export const DEMO_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_HOLD_UPCOMING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const DEMO_HOLD_CANCELLED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const DEMO_HOLD_COMPLETED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const DEMO_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function alignScheduleDay(d: Date, forward: boolean): Date {
  const allowed = [0, 2, 4];
  const next = new Date(d);
  while (!allowed.includes(next.getUTCDay())) {
    next.setUTCDate(next.getUTCDate() + (forward ? 1 : -1));
  }
  return next;
}

function buildSchedule() {
  return {
    days: ['Sun', 'Tue', 'Thu'],
    hours: '10:00 - 15:00',
    slotDuration: 30,
    leaves: [] as string[],
    Sun: { start: '10:00', end: '15:00' },
    Tue: { start: '10:00', end: '15:00' },
    Thu: { start: '10:00', end: '15:00' },
  };
}

@Injectable()
export class DemoSeeder {
  private readonly logger = new Logger(DemoSeeder.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  async seed() {
    this.logger.log('Starting Demo Seeding...');
    const now = new Date();

    let specialty = await this.dataSource.getRepository(SpecialtyEntity).findOne({ where: { name: 'Dentistry' } });
    if (!specialty) {
      specialty = await this.dataSource.getRepository(SpecialtyEntity).save(
        this.dataSource.getRepository(SpecialtyEntity).create({ name: 'Dentistry', description: 'Dentistry specialty department' }),
      );
    }

    let clinic = await this.dataSource.getRepository(ClinicEntity).findOne({ where: { name: DEMO_CLINIC_NAME } });
    if (!clinic) {
      clinic = await this.dataSource.getRepository(ClinicEntity).save(
        this.dataSource.getRepository(ClinicEntity).create({
          name: DEMO_CLINIC_NAME,
          placeType: PlaceType.CLINIC,
          governorate: 'Cairo',
          city: 'Nasr City',
          address: '12 Street 9',
          latitude: 30.0626,
          longitude: 31.3406,
        }),
      );
    }

    let doctor = await this.dataSource.getRepository(DoctorEntity).findOne({ where: { fullName: DEMO_DOCTOR_NAME } });
    if (!doctor) {
      doctor = await this.dataSource.getRepository(DoctorEntity).save(
        this.dataSource.getRepository(DoctorEntity).create({
          fullName: DEMO_DOCTOR_NAME,
          title: DoctorTitle.CONSULTANT,
          university: 'Cairo University',
          experienceYears: 12,
          averageRating: 4.5,
          totalReviews: 120,
          isVerified: true,
          isActive: true,
          gender: DoctorGender.MALE,
          specialtyId: specialty.id,
        }),
      );
    }

    const pairingRepo = this.dataSource.getRepository(DoctorClinicEntity);
    let pairing = await pairingRepo.findOne({ where: { doctorId: doctor.id, clinicId: clinic.id } });
    if (!pairing) {
      pairing = await pairingRepo.save(
        pairingRepo.create({
          doctorId: doctor.id,
          clinicId: clinic.id,
          consultationFee: 300,
          schedule: buildSchedule(),
          isActive: true,
        }),
      );
    }
    const fee = Number(pairing.consultationFee);

    const userRepo = this.dataSource.getRepository(UserEntity);
    let user = await userRepo.findOne({ where: { email: DEMO_PATIENT_EMAIL } });
    if (!user) {
      user = await userRepo.save(
        userRepo.create({
          fullName: 'Demo Patient',
          email: DEMO_PATIENT_EMAIL,
          phoneNumber: DEMO_PATIENT_PHONE,
          gender: Gender.MALE,
          passwordHash: await HashHelper.hashPassword(DEMO_PASSWORD),
          status: UserStatus.PATIENT,
          isVerified: true,
        }),
      );
    } else {
      user.fullName = 'Demo Patient';
      user.phoneNumber = DEMO_PATIENT_PHONE;
      user.status = UserStatus.PATIENT;
      user.isVerified = true;
      user.verificationCode = null;
      user.code_expires_at = null;
      user.failedAttemptsCount = 0;
      user = await userRepo.save(user);
    }

    const appointmentRepo = this.dataSource.getRepository(AppointmentEntity);
    const previous = await appointmentRepo.find({ where: { patientId: user.id } });
    const previousIds = previous.map((a) => a.id);
    if (previousIds.length > 0) {
      await this.dataSource.getRepository(RefundEntity).delete(previousIds.map((id) => ({ appointmentId: id })));
      const oldPrescriptions = await this.dataSource.getRepository(PrescriptionEntity).find({ where: { patientId: user.id } });
      const storage = new LocalPrescriptionStorageService();
      for (const row of oldPrescriptions) {
        await storage.delete(row.storageKey).catch(() => undefined);
      }
      await this.dataSource.getRepository(PrescriptionEntity).delete({ patientId: user.id });
      await appointmentRepo.delete({ patientId: user.id });
    }
    await this.dataSource.getRepository(PaymentTransaction).delete({ userId: user.id });
    await this.dataSource.getRepository(FavoriteEntity).delete({ userId: user.id });
    await this.dataSource.getRepository(NotificationEntity).delete({ userId: user.id });
    const oldConversations = await this.dataSource.getRepository(AiConversationEntity).find({ where: { patientId: user.id } });
    for (const conv of oldConversations) {
      await this.dataSource.getRepository(AiConversationEntity).delete(conv.id);
    }

    const upcoming = await appointmentRepo.save(
      appointmentRepo.create({
        doctorId: doctor.id,
        clinicId: clinic.id,
        patientId: user.id,
        date: toDateStr(alignScheduleDay(shiftDays(now, 2), true)),
        startTime: '10:00:00',
        endTime: '10:30:00',
        status: AppointmentStatus.BOOKED,
        snapshotSpecialtyName: specialty.name,
        snapshotConsultationFee: fee,
        holdId: DEMO_HOLD_UPCOMING,
      }),
    );

    const cancelled = await appointmentRepo.save(
      appointmentRepo.create({
        doctorId: doctor.id,
        clinicId: clinic.id,
        patientId: user.id,
        date: toDateStr(alignScheduleDay(shiftDays(now, 4), true)),
        startTime: '11:00:00',
        endTime: '11:30:00',
        status: AppointmentStatus.CANCELLED,
        snapshotSpecialtyName: specialty.name,
        snapshotConsultationFee: fee,
        holdId: DEMO_HOLD_CANCELLED,
        cancelledAt: now,
        cancellationOutcome: CancellationOutcome.FREE,
      }),
    );

    const completed = await appointmentRepo.save(
      appointmentRepo.create({
        doctorId: doctor.id,
        clinicId: clinic.id,
        patientId: user.id,
        date: toDateStr(alignScheduleDay(shiftDays(now, -1), false)),
        startTime: '10:00:00',
        endTime: '10:30:00',
        status: AppointmentStatus.COMPLETED,
        snapshotSpecialtyName: specialty.name,
        snapshotConsultationFee: fee,
        holdId: DEMO_HOLD_COMPLETED,
        completedAt: now,
      }),
    );

    const paymentTx = await this.dataSource.getRepository(PaymentTransaction).save(
      this.dataSource.getRepository(PaymentTransaction).create({
        userId: user.id,
        holdId: DEMO_HOLD_CANCELLED,
        amount: fee,
        status: PaymentStatus.SUCCESS,
        idempotencyKey: `PAY-${DEMO_HOLD_CANCELLED}-${user.id}`,
        providerReference: 'demo_stripe_ref_cancelled',
      }),
    );

    await this.dataSource.getRepository(RefundEntity).save(
      this.dataSource.getRepository(RefundEntity).create({
        appointmentId: cancelled.id,
        paymentTransactionId: paymentTx.id,
        amount: fee,
        status: RefundStatus.PENDING,
        idempotencyKey: `REFUND-${cancelled.id}`,
      }),
    );

    const storageKey = `${completed.id}/demo-prescription.pdf`;
    await new LocalPrescriptionStorageService().save(storageKey, DEMO_PDF, 'application/pdf');
    await this.dataSource.getRepository(PrescriptionEntity).save(
      this.dataSource.getRepository(PrescriptionEntity).create({
        appointmentId: completed.id,
        patientId: user.id,
        storageKey,
        mimeType: 'application/pdf',
        sizeBytes: DEMO_PDF.length,
        uploadedBy: DEMO_ADMIN_ID,
        uploadedAt: now,
      }),
    );

    await this.dataSource.getRepository(FavoriteEntity).save(
      this.dataSource.getRepository(FavoriteEntity).create({ userId: user.id, doctorId: doctor.id }),
    );

    const notificationRepo = this.dataSource.getRepository(NotificationEntity);
    await notificationRepo.save([
      notificationRepo.create({ userId: user.id, title: 'Booking confirmed', message: `Your appointment with ${DEMO_DOCTOR_NAME} is confirmed` }),
      notificationRepo.create({ userId: user.id, title: 'Refund issued', message: 'Your refund is on its way and should arrive within days' }),
      notificationRepo.create({ userId: user.id, title: 'Prescription ready', message: 'Your prescription is ready for download' }),
    ]);

    const conversation = await this.dataSource.getRepository(AiConversationEntity).save(
      this.dataSource.getRepository(AiConversationEntity).create({ patientId: user.id, deviceId: null }),
    );
    const messageRepo = this.dataSource.getRepository(AiMessageEntity);
    const question = await messageRepo.save(
      messageRepo.create({
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        content: 'What should I ask a dentist about tooth pain?',
        status: AiMessageStatus.SUCCESS,
      }),
    );
    await messageRepo.save(
      messageRepo.create({
        conversationId: conversation.id,
        role: AiMessageRole.ASSISTANT,
        content: 'Describe the pain location, duration and triggers. This is general information, not a diagnosis.',
        parentMessageId: question.id,
        status: AiMessageStatus.SUCCESS,
      }),
    );

    await this.redisService.del(CACHE_KEYS.CATALOG_HOME_PUBLIC_DATA);
    this.logger.log(`Demo Seeding Completed Successfully. Upcoming=${upcoming.id} Cancelled=${cancelled.id} Completed=${completed.id}`);
  }
}
