import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export class LoginRequestDto extends createZodDto(loginRequestSchema) {}

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
