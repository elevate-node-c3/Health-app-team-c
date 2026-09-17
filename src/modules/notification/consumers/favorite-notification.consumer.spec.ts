import { FavoriteNotificationConsumer } from './favorite-notification.consumer';

describe('FavoriteNotificationConsumer (CAT-7)', () => {
  let consumer: FavoriteNotificationConsumer;
  let sendNotificationUseCase: any;
  let processedRepo: any;

  const msg = { userId: 'user-1', doctorId: 'doc-1', doctorName: 'Omar Ahmed' };
  const amqpMsg = (eventId?: string) =>
    ({ properties: { headers: eventId ? { 'x-event-id': eventId } : {} } }) as any;

  beforeEach(() => {
    sendNotificationUseCase = { execute: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    processedRepo = { insert: jest.fn().mockResolvedValue({}) };
    consumer = new FavoriteNotificationConsumer(sendNotificationUseCase, processedRepo);
  });

  it('creates exactly one notification for a favorited event', async () => {
    await consumer.handleFavorited(msg, amqpMsg('evt-1'));

    expect(processedRepo.insert).toHaveBeenCalledWith({ eventId: 'evt-1', eventType: 'doctor.favorited' });
    expect(sendNotificationUseCase.execute).toHaveBeenCalledTimes(1);
    expect(sendNotificationUseCase.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'Added to favorites',
      message: 'Dr. Omar Ahmed has been added to favorite',
    });
  });

  it('skips notification when the same event is delivered twice', async () => {
    processedRepo.insert.mockRejectedValueOnce({ code: '23505' });

    await consumer.handleFavorited(msg, amqpMsg('evt-1'));

    expect(sendNotificationUseCase.execute).not.toHaveBeenCalled();
  });

  it('does not throw when the notification writer fails', async () => {
    sendNotificationUseCase.execute.mockRejectedValueOnce(new Error('db down'));

    await expect(consumer.handleFavorited(msg, amqpMsg('evt-2'))).resolves.toBeUndefined();
    expect(sendNotificationUseCase.execute).toHaveBeenCalledTimes(1);
  });
});
