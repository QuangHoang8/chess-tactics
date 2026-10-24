import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ZodValidationPipe } from "./common/zod-validation.pipe";

/** `POST /restore` takes a whole collection in one body (plan §5.4) and Express's 100kb default
 * would reject any real backup. The built-in parser has to be switched off rather than resized:
 * `useBodyParser` appends, and whichever parser claims the body first sets the limit. Multipart
 * uploads are unaffected -- `POST /imports` gets multer from its FileInterceptor, not from here. */
const BODY_LIMIT = "25mb";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: BODY_LIMIT });
  app.useBodyParser("urlencoded", { extended: true, limit: BODY_LIMIT });

  app.setGlobalPrefix("api");
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
