import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

/** Normalises every thrown HttpException into the plan §4.5 envelope: {statusCode, error, message, details?}. */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body === "object" && body !== null && "statusCode" in body) {
      // Already shaped (e.g. thrown by ZodValidationPipe) -- pass through.
      response.status(status).json(body);
      return;
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message: typeof body === "string" ? body : exception.message,
    });
  }
}
