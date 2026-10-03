import { Controller, Post, Body, Param, Req, UseGuards, ParseUUIDPipe, Get } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserStatus } from '../auth/entities/user.entity';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  @Post('holds')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT)
  createHold(@Body() dto: CreateHoldDto, @Req() req) {
    return this.bookingService.createHoldFor(req.userContext.userId, dto);
  }

  @Post('holds/:id/extend')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT)
  extendHold(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.bookingService.extendHoldFor(req.userContext.userId, id);
  }



  @Get('appointments/:id/cancellation-preview')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT)
  previewCancellation(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.bookingService.previewCancellationFor(req.userContext.userId, id);
  }

  @Post('appointments/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT)
  cancelAppointment(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.bookingService.cancelAppointmentFor(req.userContext.userId, id);
  }

  @Post('appointments/:id/reschedule')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT)
  rescheduleAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Req() req,
  ) {
    return this.bookingService.rescheduleAppointmentFor(
      req.userContext.userId,
      id,
      dto,
    );
  }

}
