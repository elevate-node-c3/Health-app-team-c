import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response as ExpressResponse } from 'express';

export interface StandardResponse<T> {
    statusCode: number;
    message: string;
    data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
    intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
        const ctx = context.switchToHttp();
        const response = ctx.getResponse<ExpressResponse>();
        const statusCode = response.statusCode;

        return next.handle().pipe(
            map((result) => {
                let message = 'Operation completed successfully';
                let data = result;

                if (result && typeof result === 'object' && 'message' in result) {
                    message = (result as any).message;
                    const { message: _, ...rest } = result as any;
                    data = rest;
                }

                return {
                    success: true,
                    statusCode,
                    message,
                    data,
                };
            }),
        );
    }
}