import { UserStatus } from '../auth/entities/user.entity';
import { BookingController } from './booking.controller';

describe('BookingController (ENG-7 Task 4)', () => {
  const controller = new BookingController({} as never);

  it('keeps every booking route PATIENT-only so guests cannot book', () => {
    expect(Reflect.getMetadata('roles', controller.createHold)).toEqual([UserStatus.PATIENT]);
    expect(Reflect.getMetadata('roles', controller.extendHold)).toEqual([UserStatus.PATIENT]);
    expect(Reflect.getMetadata('roles', controller.previewCancellation)).toEqual([UserStatus.PATIENT]);
    expect(Reflect.getMetadata('roles', controller.cancelAppointment)).toEqual([UserStatus.PATIENT]);
    expect(Reflect.getMetadata('roles', controller.rescheduleAppointment)).toEqual([UserStatus.PATIENT]);
  });
});
