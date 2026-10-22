import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { verify } from "@node-rs/argon2";
import type { LoginRequest, LoginResponse } from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { ACCESS_TOKEN_TTL_SECONDS } from "./constants";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordMatches = await verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const accessToken = await this.jwtService.signAsync({ sub: user.id });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }
}
