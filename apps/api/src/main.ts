import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT ?? 3001),
    process.env.HOST ?? '127.0.0.1',
  );
}
void bootstrap();
