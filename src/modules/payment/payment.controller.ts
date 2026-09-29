import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    Req,
    UseGuards,
    ValidationPipe,
    ParseUUIDPipe,
    HttpCode,
    HttpStatus,
    BadRequestException,
    Headers,
} from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { Roles } from "src/common/decorators/roles.decorator";
import { RolesGuard } from "src/common/guards/roles.guard";
import { UserStatus } from "../auth/entities/user.entity";
import { CreateSavedCardDto } from "./dto/create-saved-card.dto";
import { UpdateSavedCardDto } from "./dto/update-saved-card.dto";
import { ProcessPaymentDto } from "./dto/process-payment.dto";

@Controller("payments")
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Get("cards")
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async getSavedCards(@Req() req) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.getUserSavedCards(userId);
        return {
            data,
        };
    }

    @Post("cards")
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.CREATED)
    async addCard(
        @Body(new ValidationPipe({ transform: true })) dto: CreateSavedCardDto,
        @Req() req,
    ) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.addCard(userId, dto);
        return {
            data,
        };
    }

    @Patch("cards/:cardId")
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async updateCard(
        @Param("cardId", ParseUUIDPipe) cardId: string,
        @Body(new ValidationPipe({ transform: true })) dto: UpdateSavedCardDto,
        @Req() req,
    ) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.updateCard(userId, cardId, dto);
        return {
            data,
        };
    }

    @Delete("cards/:cardId")
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async deleteCard(
        @Param("cardId", ParseUUIDPipe) cardId: string,
        @Req() req,
    ) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.deleteCard(userId, cardId);
        return {
            data,
        };
    }

    @Get("summary")
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async getPaymentSummary(
        @Query("appointmentId", ParseUUIDPipe) appointmentId: string,
        @Req() req,
    ) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.getPaymentSummary(userId, appointmentId);
        return {
            data,
        };
    }



    @Post('process')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.PATIENT)
    @HttpCode(HttpStatus.OK)
    async processPayment(
        @Body(new ValidationPipe({ transform: true })) dto: ProcessPaymentDto,
        @Req() req,
    ) {
        const userId = req.userContext!.userId!;
        const data = await this.paymentService.processPayment(userId, dto);
        return {
            data,
        };
    }

    @Post('webhook')
    async handleWebhook(
        @Req() req: any,
        @Headers('stripe-signature') signature: string,
    ) {
        if (!signature) {
            throw new BadRequestException('Missing stripe-signature header');
        }
        const rawBody = req.rawBody || req.body;

        return await this.paymentService.handleWebhook(rawBody, signature);
    }
}