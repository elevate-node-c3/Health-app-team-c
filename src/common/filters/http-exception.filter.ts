import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let errorCode = 'INTERNAL_SERVER_ERROR';
        let message = 'Internal server error';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res: any = exception.getResponse();

            errorCode = res.code || res.errorCode || HttpStatus[status] || 'INTERNAL_SERVER_ERROR';
            message = res.messageKey || res.message || message;

            if (Array.isArray(res.message)) {
                message = res.message.join(', ');
            }
        } else if (exception instanceof Error) {
            message = exception.message;
        }

        response.status(status).json({
            success: false,
            statusCode: status,
            errorCode: errorCode,
            message: message,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}