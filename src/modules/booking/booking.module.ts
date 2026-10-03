import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { SlotHoldEntity } from './entities/slot-hold.entity';
import { AppointmentReminderEntity } from './entities/appointment-reminder.entity';
import { DoctorClinicEntity } from '../catalog/entities/doctor-clinic.entity';
import { AppointmentEntity } from '../catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { OutboxModule } from 'src/common/outbox/outbox.module';
import { CreateHoldUseCase } from './use-case/create-hold.use-case';
import { ExtendHoldUseCase } from './use-case/extend-hold.use-case';
import { ReleaseExpiredHoldsUseCase } from './use-case/release-expired-holds.use-case';
import { CompleteAppointmentsUseCase } from './use-case/complete-appointments.use-case';
import { SendDueRemindersUseCase } from './use-case/send-due-reminders.use-case';
import { AppointmentReminderService } from './services/appointment-reminder.service';
import { AppointmentReminderSchedulingConsumer } from './consumer/appointment-reminder-scheduling.consumer';
import { PreviewCancellationUseCase } from './use-case/preview-cancellation.use-case';
import { CancelAppointmentUseCase } from './use-case/cancel-appointment.use-case';
import { RescheduleAppointmentUseCase } from './use-case/reschedule-appointment.use-case';
import { AppointmentCancelledConsumer } from './consumer/appiontment-cancle.consumer';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SlotHoldEntity,
      AppointmentReminderEntity,
      DoctorClinicEntity,
      AppointmentEntity,
      OutboxEventEntity,
      ProcessedEventEntity,
    ]),
    OutboxModule,
    PaymentModule,
  ],
  controllers: [BookingController],
  providers: [
    BookingService,
    CreateHoldUseCase,
    ExtendHoldUseCase,
    ReleaseExpiredHoldsUseCase,
    CompleteAppointmentsUseCase,
    SendDueRemindersUseCase,
    AppointmentReminderService,
    AppointmentReminderSchedulingConsumer,
    PreviewCancellationUseCase,
    CancelAppointmentUseCase,
    RescheduleAppointmentUseCase,
    AppointmentCancelledConsumer,
  ],
})
export class BookingModule { }