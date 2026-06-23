import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { method, url } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response = context.switchToHttp().getResponse();
        const ms = Date.now() - start;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        this.logger.log(`${method} ${url} ${response.statusCode} ${ms}ms`);
      }),
    );
  }
}
