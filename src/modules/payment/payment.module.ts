import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedCard } from './entities/saved-card.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PaymentController } from './payment.controller';
import { AddSavedCardUseCase } from './use-case/add-saved-card.use-case';
import { DeleteSavedCardUseCase } from './use-case/delete-saved-card.use-case';
import { GetSavedCardsUseCase } from './use-case/get-saved-cards.use-case';
import { UpdateSavedCardUseCase } from './use-case/update-saved-card.use-case';
import { GetPaymentSummaryUseCase } from './use-case/get-payment-summary.use-case';
import { PaymentService } from './payment.service';
import { ProcessPaymentUseCase } from './use-case/process-payment.use-case';
import { HandleStripeWebhookUseCase } from './use-case/handle-stripe-webhook.use-case';
import { StripeService } from './services/stripe.service';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { DoctorEntity } from '../catalog/entities/doctor.entity';
import { SlotHoldEntity } from '../booking/entities/slot-hold.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([SavedCard, OutboxEventEntity, SlotHoldEntity, PaymentTransaction, DoctorEntity]),
    ],
    controllers: [
        PaymentController,
    ],
    providers: [
        PaymentService,
        AddSavedCardUseCase,
        DeleteSavedCardUseCase,
        GetSavedCardsUseCase,
        UpdateSavedCardUseCase,
        GetPaymentSummaryUseCase,
        ProcessPaymentUseCase,
        HandleStripeWebhookUseCase,
        StripeService,
    ]
})
export class PaymentModule { }