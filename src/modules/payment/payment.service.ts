import { Injectable } from '@nestjs/common';
import { GetSavedCardsUseCase } from './use-case/get-saved-cards.use-case';
import { AddSavedCardUseCase } from './use-case/add-saved-card.use-case';
import { UpdateSavedCardUseCase } from './use-case/update-saved-card.use-case';
import { DeleteSavedCardUseCase } from './use-case/delete-saved-card.use-case';
import { GetPaymentSummaryUseCase } from './use-case/get-payment-summary.use-case';
import { CreateSavedCardDto } from './dto/create-saved-card.dto';
import { UpdateSavedCardDto } from './dto/update-saved-card.dto';
import { ProcessPaymentUseCase } from './use-case/process-payment.use-case';
import { ProcessPaymentDto } from './dto/process-payment.dto';
import { HandleStripeWebhookUseCase } from './use-case/handle-stripe-webhook.use-case';
import { StripeService } from './services/stripe.service';

@Injectable()
export class PaymentService {
    constructor(
        private readonly getSavedCardsUseCase: GetSavedCardsUseCase,
        private readonly addSavedCardUseCase: AddSavedCardUseCase,
        private readonly updateSavedCardUseCase: UpdateSavedCardUseCase,
        private readonly deleteSavedCardUseCase: DeleteSavedCardUseCase,
        private readonly getPaymentSummaryUseCase: GetPaymentSummaryUseCase,
        private readonly processPaymentUseCase: ProcessPaymentUseCase,
        private readonly handleStripeWebhookUseCase: HandleStripeWebhookUseCase,
        private readonly stripeService: StripeService,
    ) { }

    async getUserSavedCards(userId: string) {
        return this.getSavedCardsUseCase.execute(userId);
    }

    async addCard(userId: string, dto: CreateSavedCardDto) {
        return this.addSavedCardUseCase.execute(userId, dto);
    }

    async updateCard(userId: string, cardId: string, dto: UpdateSavedCardDto) {
        return this.updateSavedCardUseCase.execute(userId, cardId, dto);
    }

    async deleteCard(userId: string, cardId: string) {
        return this.deleteSavedCardUseCase.execute(userId, cardId);
    }

    async getPaymentSummary(userId: string, appointmentId: string) {
        return this.getPaymentSummaryUseCase.execute(userId, appointmentId);
    }

    async processPayment(userId: string, dto: ProcessPaymentDto) {
        return this.processPaymentUseCase.execute(userId, dto);
    }

    async handleWebhook(payload: Buffer, signature: string) {
        const event = this.stripeService.constructWebhookEvent(payload, signature);
        return this.handleStripeWebhookUseCase.execute(event);
    }
}