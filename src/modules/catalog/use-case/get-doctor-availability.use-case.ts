import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DoctorClinicEntity } from '../entities/doctor-clinic.entity';
import { AppointmentEntity, AppointmentStatus } from '../entities/appointment.entity';
import { SlotHoldEntity, SlotHoldStatus } from '../../booking/entities/slot-hold.entity';

export interface GetDoctorAvailabilityInput {
    doctorId: string;
    clinicId: string;
    date: string; // YYYY-MM-DD
}

@Injectable()
export class GetDoctorAvailabilityUseCase {
    constructor(
        @InjectRepository(DoctorClinicEntity)
        private readonly doctorClinicRepo: Repository<DoctorClinicEntity>,
        @InjectRepository(AppointmentEntity)
        private readonly appointmentRepo: Repository<AppointmentEntity>,
        @InjectRepository(SlotHoldEntity)
        private readonly holdRepo: Repository<SlotHoldEntity>,
    ) { }

    async execute(input: GetDoctorAvailabilityInput) {
        const pairing = await this.doctorClinicRepo.findOne({
            where: { doctorId: input.doctorId, clinicId: input.clinicId },
            relations: ['doctor', 'clinic'],
        });

        if (!pairing || !pairing.isActive || !pairing.doctor.isActive || !pairing.doctor.isVerified || !pairing.clinic.isActive) {
            throw new NotFoundException('Doctor or clinic pairing is not available');
        }

        // Validate date
        const targetDate = new Date(input.date);
        if (isNaN(targetDate.getTime())) {
            throw new BadRequestException('Invalid date format');
        }

        // Africa/Cairo logic
        const cairoTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const now = new Date(cairoTime);
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        if (input.date < todayStr) {
            throw new BadRequestException('Cannot book in the past');
        }

        // Max booking horizon (e.g., 60 days)
        const maxDate = new Date(now);
        maxDate.setDate(maxDate.getDate() + 60);
        const maxDateStr = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}-${String(maxDate.getDate()).padStart(2, '0')}`;
        
        if (input.date > maxDateStr) {
            throw new BadRequestException('Date is too far in the future');
        }

        const dayTokens = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const targetDay = dayTokens[targetDate.getDay()];

        const schedule = pairing.schedule || {};
        const daySchedule = schedule[targetDay];
        
        const isLeave = schedule.leaves && schedule.leaves.includes(input.date);

        const consultationFee = Number(pairing.consultationFee);

        if (!daySchedule || isLeave) {
            return {
                success: true,
                data: {
                    consultationFee,
                    date: input.date,
                    slots: { Morning: [], Afternoon: [], Night: [] }
                }
            };
        }

        // Generate slots
        const startStr = daySchedule.start || '09:00';
        const endStr = daySchedule.end || '17:00';
        const slotDuration = schedule.slotDuration || 30; // in minutes

        const generatedSlots = this.generateSlots(startStr, endStr, slotDuration);

        // Fetch bookings
        const bookings = await this.appointmentRepo.find({
            where: {
                doctorId: input.doctorId,
                clinicId: input.clinicId,
                date: input.date,
            }
        });
        const takenTimes = new Set(
            bookings.filter(b => b.status !== AppointmentStatus.CANCELLED).map(b => b.startTime.substring(0, 5))
        );

        const holds = await this.holdRepo.find({
            where: {
                doctorId: input.doctorId,
                clinicId: input.clinicId,
                date: input.date,
                status: SlotHoldStatus.ACTIVE,
            },
        });
        const nowTs = Date.now();
        for (const h of holds) {
            if (new Date(h.expiresAt).getTime() > nowTs) {
                takenTimes.add(h.startTime.substring(0, 5));
            }
        }

        const isToday = input.date === todayStr;
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTimeInt = currentHours * 60 + currentMinutes;

        const Morning: Array<{time: string, status: string}> = [];
        const Afternoon: Array<{time: string, status: string}> = [];
        const Night: Array<{time: string, status: string}> = [];

        for (const slot of generatedSlots) {
            const [sh, sm] = slot.split(':').map(Number);
            const slotTimeInt = sh * 60 + sm;

            if (isToday && slotTimeInt <= currentTimeInt) {
                continue; // Past time today
            }

            const isTaken = takenTimes.has(slot);
            const slotObj = {
                time: slot,
                status: isTaken ? 'TAKEN' : 'AVAILABLE'
            };

            if (sh < 12) {
                Morning.push(slotObj);
            } else if (sh < 17) {
                Afternoon.push(slotObj);
            } else {
                Night.push(slotObj);
            }
        }

        return {
            success: true,
            data: {
                consultationFee,
                date: input.date,
                slots: { Morning, Afternoon, Night }
            }
        };
    }

    private generateSlots(start: string, end: string, durationMin: number): string[] {
        const slots: string[] = [];
        let [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);

        let currentTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        while (currentTotal + durationMin <= endTotal) {
            const h = Math.floor(currentTotal / 60);
            const m = currentTotal % 60;
            const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            slots.push(timeStr);
            currentTotal += durationMin;
        }

        return slots;
    }
}
