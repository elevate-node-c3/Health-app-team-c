import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../modules/auth/entities/user.entity';
import { DoctorEntity } from '../../modules/catalog/entities/doctor.entity';
import { SpecialtyEntity } from '../../modules/catalog/entities/specialty.entity';
import { ClinicEntity } from '../../modules/catalog/entities/clinic.entity';
import { DoctorClinicEntity } from '../../modules/catalog/entities/doctor-clinic.entity';
import { AppointmentEntity } from '../../modules/catalog/entities/appointment.entity';
import { FavoriteEntity } from '../../modules/catalog/entities/favorite.entity';
import { PaymentTransaction } from '../../modules/payment/entities/payment-transaction.entity';
import { RefundEntity } from '../../modules/payment/entities/refund.entity';
import { PrescriptionEntity } from '../../modules/prescription/entities/prescription.entity';
import { NotificationEntity } from '../../modules/notification/entities/notification.entity';
import { AiConversationEntity } from '../../modules/ai-assistant/entities/ai-conversation.entity';
import { AiMessageEntity } from '../../modules/ai-assistant/entities/ai-message.entity';
import { LocalPrescriptionStorageService } from '../../modules/prescription/local-prescription-storage.service';
import { DEMO_PATIENT_EMAIL, DemoSeeder } from './demo.seed';

const enabled = !!process.env.DB_HOST || !!process.env.DB_NAME;
const describeReal = enabled ? describe : describe.skip;

describeReal('DemoSeeder (real Postgres)', () => {
  let ds: DataSource;
  let storageDir: string;
  let seeder: DemoSeeder;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'demo-seed-'));
    process.env.PRESCRIPTION_STORAGE_PATH = storageDir;

    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5433),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'docura',
      entities: [
        SpecialtyEntity,
        ClinicEntity,
        DoctorEntity,
        DoctorClinicEntity,
        UserEntity,
        AppointmentEntity,
        PaymentTransaction,
        RefundEntity,
        PrescriptionEntity,
        FavoriteEntity,
        NotificationEntity,
        AiConversationEntity,
        AiMessageEntity,
      ],
      synchronize: true,
    });
    await ds.initialize();
    seeder = new DemoSeeder(ds, { del: jest.fn().mockResolvedValue(undefined) } as never);
  });

  afterAll(async () => {
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.PRESCRIPTION_STORAGE_PATH;
    if (ds?.isInitialized) await ds.destroy();
  });

  async function counts() {
    const user = await ds.getRepository(UserEntity).findOneOrFail({ where: { email: DEMO_PATIENT_EMAIL } });
    const where = { patientId: user.id };
    return {
      user,
      appointments: await ds.getRepository(AppointmentEntity).count({ where }),
      refunds: await ds.getRepository(RefundEntity).count(),
      payments: await ds.getRepository(PaymentTransaction).count({ where: { userId: user.id } }),
      prescriptions: await ds.getRepository(PrescriptionEntity).count({ where }),
      favorites: await ds.getRepository(FavoriteEntity).count({ where: { userId: user.id } }),
      notifications: await ds.getRepository(NotificationEntity).count({ where: { userId: user.id } }),
      conversations: await ds.getRepository(AiConversationEntity).count({ where }),
      messages: await ds.getRepository(AiMessageEntity).count(),
    };
  }

  it('seeds the demo story twice with identical counts', async () => {
    await seeder.seed();
    const first = await counts();
    await seeder.seed();
    const second = await counts();

    expect(second.appointments).toBe(3);
    expect(second.refunds).toBe(1);
    expect(second.payments).toBe(1);
    expect(second.prescriptions).toBe(1);
    expect(second.favorites).toBe(1);
    expect(second.notifications).toBe(3);
    expect(second.conversations).toBe(1);
    expect(second.messages).toBe(2);
    expect({
      appointments: second.appointments,
      refunds: second.refunds,
      payments: second.payments,
      prescriptions: second.prescriptions,
      favorites: second.favorites,
      notifications: second.notifications,
      conversations: second.conversations,
      messages: second.messages,
    }).toEqual({
      appointments: first.appointments,
      refunds: first.refunds,
      payments: first.payments,
      prescriptions: first.prescriptions,
      favorites: first.favorites,
      notifications: first.notifications,
      conversations: first.conversations,
      messages: first.messages,
    });
  });

  it('leaves upcoming booked, cancelled with pending refund, completed with readable prescription', async () => {
    const { user } = await counts();
    const appointments = await ds.getRepository(AppointmentEntity).find({ where: { patientId: user.id } });
    const byStatus = Object.fromEntries(appointments.map((a) => [a.status, a]));

    expect(byStatus.BOOKED.date >= new Date().toISOString().slice(0, 10)).toBe(true);

    const refund = await ds.getRepository(RefundEntity).findOneOrFail({ where: { appointmentId: byStatus.CANCELLED.id } });
    expect(refund.status).toBe('PENDING');

    const prescription = await ds.getRepository(PrescriptionEntity).findOneOrFail({
      where: { appointmentId: byStatus.COMPLETED.id },
    });
    const bytes = await new LocalPrescriptionStorageService().read(prescription.storageKey);
    expect(bytes.length).toBe(prescription.sizeBytes);
  });
});
