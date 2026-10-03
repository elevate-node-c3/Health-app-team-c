import { CallHandler } from '@nestjs/common';
import { throwError } from 'rxjs';
import { PrescriptionFileInterceptor } from './prescription-file.interceptor';

describe('PrescriptionFileInterceptor', () => {
  const interceptor = new PrescriptionFileInterceptor();
  const context = {} as never;

  function nextWith(error: unknown): CallHandler {
    return { handle: () => throwError(() => error) } as CallHandler;
  }

  it('maps LIMIT_FILE_SIZE to PRESCRIPTION_TOO_LARGE 413', (done) => {
    interceptor.intercept(context, nextWith({ code: 'LIMIT_FILE_SIZE' })).subscribe({
      error: (err) => {
        expect(err.getStatus()).toBe(413);
        expect(err.getResponse()).toMatchObject({ code: 'PRESCRIPTION_TOO_LARGE' });
        done();
      },
    });
  });

  it('lets other upload errors through untouched', (done) => {
    interceptor.intercept(context, nextWith(new Error('multer blew up'))).subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('multer blew up');
        done();
      },
    });
  });
});
