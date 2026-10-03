import { RefundEntity, RefundStatus } from '../entities/refund.entity';
import { findActiveRefundForAppointment, hasPendingRefund } from './refund-status.reader';

function buildManager(refunds: RefundEntity[]) {
  const repo = {
    findOne: jest.fn(async ({ where }: { where: { appointmentId: string } }) =>
      refunds.find((r) => r.appointmentId === where.appointmentId && (r.status === RefundStatus.PENDING || r.status === RefundStatus.ISSUED)) ?? null,
    ),
  };
  return { getRepository: jest.fn(() => repo) };
}

function refund(appointmentId: string, status: RefundStatus): RefundEntity {
  const r = new RefundEntity();
  r.id = `refund-${appointmentId}-${status}`;
  r.appointmentId = appointmentId;
  r.status = status;
  return r;
}

describe('refund-status.reader', () => {
  it('reports pending for PENDING rows', async () => {
    const manager = buildManager([refund('a1', RefundStatus.PENDING)]);
    await expect(hasPendingRefund(manager as never, 'a1')).resolves.toBe(true);
    await expect(findActiveRefundForAppointment(manager as never, 'a1')).resolves.not.toBeNull();
  });

  it('reports pending for ISSUED rows', async () => {
    const manager = buildManager([refund('a2', RefundStatus.ISSUED)]);
    await expect(hasPendingRefund(manager as never, 'a2')).resolves.toBe(true);
  });

  it('reports clear for SETTLED, FAILED, and missing rows', async () => {
    const manager = buildManager([refund('a3', RefundStatus.SETTLED), refund('a4', RefundStatus.FAILED)]);
    await expect(hasPendingRefund(manager as never, 'a3')).resolves.toBe(false);
    await expect(hasPendingRefund(manager as never, 'a4')).resolves.toBe(false);
    await expect(hasPendingRefund(manager as never, 'missing')).resolves.toBe(false);
    await expect(findActiveRefundForAppointment(manager as never, 'missing')).resolves.toBeNull();
  });
});
