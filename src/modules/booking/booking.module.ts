import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { SlotHoldEntity } from './entities/slot-hold.entity';
import { DoctorClinicEntity } from '../catalog/entities/doctor-clinic.entity';
import { AppointmentEntity } from '../catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { CreateHoldUseCase } from './use-case/create-hold.use-case';
import { ExtendHoldUseCase } from './use-case/extend-hold.use-case';
import { ReleaseExpiredHoldsUseCase } from './use-case/release-expired-holds.use-case';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SlotHoldEntity,
      DoctorClinicEntity,
      AppointmentEntity,
      OutboxEventEntity,
    ]),
  ],
  controllers: [BookingController],
  providers: [
    BookingService,
    CreateHoldUseCase,
    ExtendHoldUseCase,
    ReleaseExpiredHoldsUseCase,
  ],
})
export class BookingModule {}
