import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { LoginRequestDto, type LoginResponse } from "@chess-tactics/contracts";
import { Public } from "../common/public.decorator";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginRequestDto): Promise<LoginResponse> {
    return this.authService.login(body);
  }
}
