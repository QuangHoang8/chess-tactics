import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/public.decorator";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get("health")
  getHealth(): { status: "ok" } {
    return this.appService.getHealth();
  }
}
