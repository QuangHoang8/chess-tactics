import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Opt a route out of the global JwtAuthGuard (plan §1.2: login is the only public route). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
