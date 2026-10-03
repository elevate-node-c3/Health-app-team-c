import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable()
export class PrescriptionFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) =>
        throwError(() =>
          typeof err === 'object' && err !== null && (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
            ? new PayloadTooLargeException({
                code: 'PRESCRIPTION_TOO_LARGE',
                messageKey: 'errors.prescription.too_large',
                message: 'Prescription file exceeds the size limit',
              })
            : err,
        ),
      ),
    );
  }
}
