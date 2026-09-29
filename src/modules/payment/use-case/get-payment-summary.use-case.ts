import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class GetPaymentSummaryUseCase {
    constructor(
    ) { }

    async execute(userId: string, appointmentId: string) {

        // const appointment = await this.appointmentRepository.findOne({ where: { id: appointmentId, userId } });
        // if (!appointment) throw new NotFoundException('Appointment not found');

        const bookingPrice = 200.0;
        const discount = 0.0;
        const fees = 0.0;

        const total = bookingPrice - discount + fees;

        return {
            bookingPrice: Number(bookingPrice.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            fees: Number(fees.toFixed(2)),
            total: Number(total.toFixed(2)),
            currency: 'EGP',
        };
    }
}



// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Appointment } from '../entities/appointment.entity';

// @Injectable()
// export class GetPaymentSummaryUseCase {
//   constructor(
//     @InjectRepository(Appointment)
//     private readonly appointmentRepository: Repository<Appointment>,
//   ) {}

//   async execute(userId: string, appointmentId: string) {
//     const appointment = await this.appointmentRepository.findOne({
//       where: { id: appointmentId, userId },
//       relations: ['promocode'],
//     });

//     if (!appointment) {
//       throw new NotFoundException(
//         'Appointment not found or does not belong to the user',
//       );
//     }

//     if (appointment.status !== 'PENDING_PAYMENT') {
//       throw new BadRequestException(
//         `Cannot generate payment summary for appointment with status: ${appointment.status}`,
//       );
//     }

//     const bookingPrice = Number(appointment.holdPrice || appointment.price);
//     const discount = Number(appointment.discountAmount || 0);
//     const fees = Number(appointment.serviceFee || 0);
//     const rawTotal = bookingPrice - discount + fees;
//     const total = Math.max(0, rawTotal);

//     return {
//       appointmentId: appointment.id,
//       bookingPrice: Number(bookingPrice.toFixed(2)),
//       discount: Number(discount.toFixed(2)),
//       fees: Number(fees.toFixed(2)),
//       total: Number(total.toFixed(2)),
//       currency: appointment.currency || 'EGP',
//     };
//   }
// }