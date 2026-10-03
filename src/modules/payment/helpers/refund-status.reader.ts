import { EntityManager, In } from 'typeorm';
import { RefundEntity, RefundStatus } from '../entities/refund.entity';

const ACTIVE_STATUSES = [RefundStatus.PENDING, RefundStatus.ISSUED];

export async function findActiveRefundForAppointment(
  manager: EntityManager,
  appointmentId: string,
): Promise<RefundEntity | null> {
  return manager.getRepository(RefundEntity).findOne({
    where: { appointmentId, status: In(ACTIVE_STATUSES) },
  });
}

export async function hasPendingRefund(
  manager: EntityManager,
  appointmentId: string,
): Promise<boolean> {
  const found = await findActiveRefundForAppointment(manager, appointmentId);
  return found !== null;
}
