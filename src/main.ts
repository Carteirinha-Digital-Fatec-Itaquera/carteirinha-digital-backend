import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe());
  console.log(`\nlink de acesso: \nhttp://localhost:3000/secretaria/criar`)
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
