import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ZodValidationPipe } from "./common/zod-validation.pipe";

/** `POST /restore` takes a whole collection in one body (plan §5.4) and Express's 100kb default
 * would reject any real backup. The parsers have to be installed by hand rather than resized,
 * because Nest's built-in one claims the body first and whichever runs first sets the limit. */
const BODY_LIMIT = "25mb";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));

  app.setGlobalPrefix("api");
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
