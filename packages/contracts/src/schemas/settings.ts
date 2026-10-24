import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

/** Plan §4 `UserSettings`, with §12's owner overrides as the defaults. `reviewsPerDay: null` means
 * unlimited -- distinct from "unset", which is why the field is nullable rather than optional. */
export const userSettingsSchema = z.object({
  timezone: z.string(),
  dayRolloverHour: z.number().int().min(0).max(23),
  newPerDay: z.number().int().min(0),
  reviewsPerDay: z.number().int().min(0).nullable(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/**
 * An IANA zone name, validated against the runtime's own tz database rather than a hand-kept list.
 * A bad zone would otherwise surface much later as an `Intl` throw inside `civilDateFor`, during
 * queue building, with no connection back to the settings write that caused it.
 */
const timezoneSchema = z.string().superRefine((value, ctx) => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown timezone "${value}"` });
  }
});

/** Plan §4.5: `PATCH /settings` with every field optional. `reviewsPerDay` accepts an explicit
 * `null` to clear the cap, so it is `.nullable().optional()` rather than merely optional. */
export const updateSettingsRequestSchema = z.object({
  timezone: timezoneSchema.optional(),
  dayRolloverHour: z.number().int().min(0).max(23).optional(),
  newPerDay: z.number().int().min(0).optional(),
  reviewsPerDay: z.number().int().min(0).nullable().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
export class UpdateSettingsRequestDto extends createZodDto(updateSettingsRequestSchema) {}
