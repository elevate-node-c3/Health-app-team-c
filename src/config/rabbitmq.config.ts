import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => ({
    uri: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
}));