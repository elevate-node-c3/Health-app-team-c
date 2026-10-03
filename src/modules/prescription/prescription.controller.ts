import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, PayloadTooLargeException, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserStatus } from 'src/modules/auth/entities/user.entity';
import { PrescriptionService } from './prescription.service';
import { PrescriptionParamsDto } from './dto/prescription-params.dto';
import { prescriptionMaxBytes } from './use-case/attach-prescription.use-case';

@Controller('prescriptions')
export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  @Post('appointments/:appointmentId/file')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: prescriptionMaxBytes() } }))
  async attach(
    @Param() params: PrescriptionParamsDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'PRESCRIPTION_FILE_REQUIRED',
        messageKey: 'errors.prescription.file_required',
        message: 'A prescription file is required',
      });
    }
    try {
      const prescription = await this.prescriptionService.attachFor(
        req.userContext.userId,
        params.appointmentId,
        file.buffer,
      );
      return {
        message: 'prescription.attached',
        data: {
          prescriptionId: prescription.id,
          appointmentId: prescription.appointmentId,
          mimeType: prescription.mimeType,
          sizeBytes: prescription.sizeBytes,
          uploadedAt: prescription.uploadedAt,
        },
      };
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        throw new PayloadTooLargeException({
          code: 'PRESCRIPTION_TOO_LARGE',
          messageKey: 'errors.prescription.too_large',
          message: 'Prescription file exceeds the size limit',
        });
      }
      throw err;
    }
  }

  @Put('appointments/:appointmentId/file')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: prescriptionMaxBytes() } }))
  async replace(
    @Param() params: PrescriptionParamsDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'PRESCRIPTION_FILE_REQUIRED',
        messageKey: 'errors.prescription.file_required',
        message: 'A prescription file is required',
      });
    }
    try {
      const prescription = await this.prescriptionService.replaceFor(
        req.userContext.userId,
        params.appointmentId,
        file.buffer,
      );
      return {
        message: 'prescription.replaced',
        data: {
          prescriptionId: prescription.id,
          appointmentId: prescription.appointmentId,
          mimeType: prescription.mimeType,
          sizeBytes: prescription.sizeBytes,
          uploadedAt: prescription.uploadedAt,
        },
      };
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        throw new PayloadTooLargeException({
          code: 'PRESCRIPTION_TOO_LARGE',
          messageKey: 'errors.prescription.too_large',
          message: 'Prescription file exceeds the size limit',
        });
      }
      throw err;
    }
  }

  @Get('appointments/:appointmentId')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT, UserStatus.ADMIN)
  async metadata(@Param() params: PrescriptionParamsDto, @Req() req) {
    const data = await this.prescriptionService.metadataFor(
      req.userContext.userId,
      req.userContext.role,
      params.appointmentId,
    );
    return { message: 'prescription.metadata', data };
  }

  @Get('appointments/:appointmentId/download-link')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT, UserStatus.ADMIN)
  async downloadLink(@Param() params: PrescriptionParamsDto, @Req() req) {
    const data = await this.prescriptionService.linkFor(
      req.userContext.userId,
      req.userContext.role,
      params.appointmentId,
    );
    return { message: 'prescription.download_link', data };
  }

  @Get('download')
  @UseGuards(RolesGuard)
  @Roles(UserStatus.PATIENT, UserStatus.ADMIN)
  async download(@Query('token') token: string, @Req() req, @Res() res: Response) {
    const { buffer, mimeType, sizeBytes } = await this.prescriptionService.downloadFor(
      req.userContext.userId,
      req.userContext.role,
      token,
    );
    res.set({ 'Content-Type': mimeType, 'Content-Length': String(sizeBytes) });
    res.send(buffer);
  }
}
