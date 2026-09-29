import { Injectable } from '@nestjs/common';
import { CreateHoldUseCase } from './use-case/create-hold.use-case';
import { ExtendHoldUseCase } from './use-case/extend-hold.use-case';
import { CreateHoldDto } from './dto/create-hold.dto';

@Injectable()
export class BookingService {
  constructor(
    private readonly createHold: CreateHoldUseCase,
    private readonly extendHold: ExtendHoldUseCase,
  ) {}

  createHoldFor(patientId: string, dto: CreateHoldDto) {
    return this.createHold.execute(patientId, dto);
  }

  extendHoldFor(patientId: string, holdId: string) {
    return this.extendHold.execute(patientId, holdId);
  }
}
