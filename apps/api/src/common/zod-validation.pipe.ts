import { ArgumentMetadata, Injectable, PipeTransform, UnprocessableEntityException } from "@nestjs/common";
import type { ZodSchema } from "zod";

interface ZodDtoMetatype {
  schema?: ZodSchema;
}

/**
 * Registered globally (app.useGlobalPipes). Only acts on parameters whose metatype carries a
 * static `schema` (see packages/contracts' createZodDto) -- anything else passes through
 * unchanged, so this never interferes with plain primitives or undecorated params.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as ZodDtoMetatype | undefined;
    const schema = metatype?.schema;
    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      // Plan §4.5: 422 with per-field details.
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: "Validation failed",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
