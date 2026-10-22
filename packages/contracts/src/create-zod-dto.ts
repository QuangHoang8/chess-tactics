import type { ZodSchema, z } from "zod";

export interface ZodDto<T = unknown> {
  new (): T;
  schema: ZodSchema<T>;
}

/**
 * Wraps a Zod schema in a class with a static `schema` property. NestJS's reflection sees a real
 * class (the `metatype`) on @Body()/@Query() parameters, which the api's global ZodValidationPipe
 * reads to validate -- the same mechanism class-validator DTOs use, without pulling that in too.
 */
export function createZodDto<T extends ZodSchema>(schema: T): ZodDto<z.infer<T>> {
  class AugmentedZodDto {
    static schema = schema;
  }
  return AugmentedZodDto as ZodDto<z.infer<T>>;
}
