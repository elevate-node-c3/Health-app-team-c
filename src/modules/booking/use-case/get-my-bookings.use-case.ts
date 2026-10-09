import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan, MoreThanOrEqual, IsNull } from 'typeorm';
import { AppointmentEntity, AppointmentStatus } from '../../catalog/entities/appointment.entity';
import { PrescriptionEntity } from '../../prescription/entities/prescription.entity';
import { GetMyBookingsDto } from '../dto/get-my-bookings.dto';

export interface BookingCard {
    id: string;
    doctorPhoto: string | null;
    doctorName: string;
    specialty: string;
    clinic: string;
    area: string;
    date: string;
    time: string;
    status: AppointmentStatus;
    actions: string[];
}

@Injectable()
export class GetMyBookingsUseCase {
    constructor(
        @InjectRepository(AppointmentEntity)
        private readonly appointmentRepo: Repository<AppointmentEntity>,
        @InjectRepository(PrescriptionEntity)
        private readonly prescriptionRepo: Repository<PrescriptionEntity>,
    ) { }

    async execute(userId: string, dto: GetMyBookingsDto) {
        const { tab = 'ALL', page = 1, limit = 10 } = dto;
        const qb = this.appointmentRepo.createQueryBuilder('app')
            .leftJoinAndSelect('app.doctor', 'doctor')
            .leftJoinAndSelect('app.clinic', 'clinic')
            .where('app.patientId = :userId', { userId });

        if (tab === 'UPCOMING') {
            qb.andWhere('app.status = :status', { status: AppointmentStatus.BOOKED });
        } else if (tab === 'COMPLETED') {
            qb.andWhere('app.status = :status', { status: AppointmentStatus.COMPLETED });
        } else if (tab === 'CANCELLED') {
            qb.andWhere('app.status IN (:...statuses)', { statuses: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] });
        }

        qb.orderBy('app.date', 'DESC')
          .addOrderBy('app.startTime', 'DESC');

        const [rows, total] = await qb
            .skip((page - 1) * limit)
            .take(limit)
            .getManyAndCount();

        const appointmentIds = rows.map(r => r.id);
        let prescriptions: PrescriptionEntity[] = [];
        
        if (appointmentIds.length > 0 && (tab === 'ALL' || tab === 'COMPLETED')) {
            prescriptions = await this.prescriptionRepo.find({
                where: { appointmentId: In(appointmentIds), replacedBy: IsNull() }
            });
        }
        
        const prescriptionMap = new Map(prescriptions.map(p => [p.appointmentId, p.id]));

        const cairoTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const now = new Date(cairoTime);
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTimeInt = currentHours * 60 + currentMinutes;

        const data: BookingCard[] = rows.map(app => {
            const actions: string[] = [];
            
            // Check if upcoming appointment time has actually passed
            let displayStatus = app.status;
            if (displayStatus === AppointmentStatus.BOOKED) {
                const isPastDate = app.date < todayStr;
                const [sh, sm] = app.startTime.split(':').map(Number);
                const slotTimeInt = sh * 60 + sm;
                const isPastTimeToday = app.date === todayStr && slotTimeInt < currentTimeInt;
                
                if (isPastDate || isPastTimeToday) {
                    // While the backend cron hasn't marked it completed/no-show yet, 
                    // visually it shouldn't allow CANCEL/RESCHEDULE anymore.
                    // It's effectively 'processing' or we can just leave it as BOOKED without actions.
                } else {
                    actions.push('CANCEL', 'RESCHEDULE');
                }
            } else if (displayStatus === AppointmentStatus.COMPLETED) {
                if (prescriptionMap.has(app.id)) {
                    actions.push('DOWNLOAD_PRESCRIPTION');
                }
            } else if (displayStatus === AppointmentStatus.CANCELLED || displayStatus === AppointmentStatus.NO_SHOW) {
                // Rebook only allowed if doctor and clinic are currently active
                if (app.doctor?.isActive && app.clinic?.isActive) {
                    actions.push('REBOOK');
                }
            }

            return {
                id: app.id,
                doctorPhoto: app.doctor?.photoUrl || null,
                doctorName: app.doctor?.fullName || 'Unknown Doctor',
                specialty: app.snapshotSpecialtyName || 'General',
                clinic: app.clinic?.name || 'Unknown Clinic',
                area: app.clinic ? `${app.clinic.city}, ${app.clinic.governorate}` : 'Unknown Area',
                date: app.date,
                time: app.startTime,
                status: displayStatus,
                actions,
            };
        });

        return {
            success: true,
            data,
            meta: {
                total,
                page,
                limit,
            }
        };
    }
}
