import { EntityManager } from 'typeorm';
import {
    AppointmentEntity,
    AppointmentStatus,
} from 'src/modules/catalog/entities/appointment.entity';
import { SlotHoldEntity } from 'src/modules/booking/entities/slot-hold.entity';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';


export async function createAppointmentFromHold(
    manager: EntityManager,
    hold: SlotHoldEntity,
): Promise<AppointmentEntity> {
    const appointmentRepo = manager.getRepository(AppointmentEntity);

    const existing = await appointmentRepo.findOne({ where: { holdId: hold.id } });
    if (existing) return existing;

    const doctor = await manager.getRepository(DoctorEntity).findOne({
        where: { id: hold.doctorId },
        relations: ['specialty'],
    });

    const appointment = appointmentRepo.create({
        patientId: hold.patientId,
        doctorId: hold.doctorId,
        clinicId: hold.clinicId,
        holdId: hold.id,
        date: hold.date,
        startTime: hold.startTime,
        endTime: hold.endTime,
        status: AppointmentStatus.BOOKED,
        snapshotConsultationFee: hold.frozenFee,
        snapshotSpecialtyName: doctor?.specialty?.name ?? undefined,
    });


    return appointmentRepo.save(appointment);
}