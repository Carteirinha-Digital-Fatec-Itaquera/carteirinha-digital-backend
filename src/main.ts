import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:4173',
      'https://carteirinha-digital-front-end-secretaria-iryl-ewmgqh24h.vercel.app',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe());

  const PORT = process.env.PORT || 3000;

  // O host '0.0.0.0' é essencial para que o container Docker aceite conexões externas (Render/Cloud)
  await app.listen(PORT, '0.0.0.0');

  console.log(`🚀 Backend da Carteirinha Digital rodando na porta ${PORT}`);
  console.log(`🏠 Local: http://localhost:${PORT}`);
  console.log(`🌐 Rede (seu IP): http://192.168.1.106:${PORT}`);

}
void bootstrap();