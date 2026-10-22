import { z } from "zod";

/** Plan §4.5: one error envelope shape for every endpoint. */
export const errorEnvelopeSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  details: z
    .array(
      z.object({
        path: z.string(),
        ply: z.number().optional(),
        input: z.string().optional(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
