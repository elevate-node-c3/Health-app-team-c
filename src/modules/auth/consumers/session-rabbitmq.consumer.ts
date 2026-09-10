import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';

interface SessionCreatedPayload {
    userId: string;
    familyId: string;
    deviceLabel: string | null;
    createdAt: string;
}

interface SessionEndedPayload {
    userId: string;
    familyId: string;
    endedAt: string;
    reason: 'user_signout' | 'signout_everywhere' | 'password_reset';
}

interface SessionTheftDetectedPayload {
    userId: string;
    familyId: string;
    detectedAt: string;
}

@Injectable()
export class SessionRabbitMQConsumer {
    private readonly logger = new Logger(SessionRabbitMQConsumer.name);

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'session.created',
        queue: 'session_created_queue',
    })
    public async handleSessionCreated(msg: SessionCreatedPayload) {
        this.logger.log(
            `[session.created] userId=${msg.userId} familyId=${msg.familyId} device="${msg.deviceLabel ?? 'unknown'}"`,
        );
    }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'session.ended',
        queue: 'session_ended_queue',
    })
    public async handleSessionEnded(msg: SessionEndedPayload) {
        this.logger.log(
            `[session.ended] userId=${msg.userId} familyId=${msg.familyId} reason=${msg.reason}`,
        );
    }

    @RabbitSubscribe({
        exchange: 'auth_exchange',
        routingKey: 'session.theft_detected',
        queue: 'session_theft_detected_queue',
    })
    public async handleTheftDetected(msg: SessionTheftDetectedPayload) {
        this.logger.warn(
            `[session.theft_detected] ⚠️  CREDENTIAL REUSE DETECTED — userId=${msg.userId} familyId=${msg.familyId}`,
        );
        // TODO: trigger alert (email, Slack, PagerDuty, etc.)
    }
}
