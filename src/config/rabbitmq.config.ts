import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => ({
    uri: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
}));