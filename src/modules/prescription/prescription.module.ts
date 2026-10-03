import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from './entities/prescription.entity';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';
import { LocalPrescriptionStorageService } from './local-prescription-storage.service';
import { PRESCRIPTION_STORAGE } from './prescription-storage.interface';
import { AttachPrescriptionUseCase } from './use-case/attach-prescription.use-case';

@Module({
  imports: [TypeOrmModule.forFeature([PrescriptionEntity, AppointmentEntity, OutboxEventEntity])],
  controllers: [PrescriptionController],
  providers: [
    PrescriptionService,
    AttachPrescriptionUseCase,
    LocalPrescriptionStorageService,
    { provide: PRESCRIPTION_STORAGE, useExisting: LocalPrescriptionStorageService },
  ],
})
export class PrescriptionModule {}
