import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins: (string | RegExp)[] = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:4173',
    'http://localhost:4174',
    /^http:\/\/localhost:\d+$/,
    'https://carteirinha-digital-front-end-secre-topaz.vercel.app',
    'https://carteirinha-digital-front-end-secre.vercel.app',
    'https://carteirinha-digital-front-end-aluno.vercel.app',
  ];
  const employeeOrigin = process.env.EMPLOYEE_APP_URL?.trim();
  if (employeeOrigin) {
    allowedOrigins.push(employeeOrigin);
  }
  const studentOrigin = process.env.STUDENT_APP_URL?.trim();
  if (studentOrigin && !allowedOrigins.includes(studentOrigin)) {
    allowedOrigins.push(studentOrigin);
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe());

  const PORT = process.env.PORT ?? 3000;
  await app.listen(PORT, '0.0.0.0');

  console.log(`\n🚀 Backend da Carteirinha Digital rodando!`);
  console.log(`🏠 Local: http://localhost:${PORT}`);
  console.log(`🌐 Rede (seu IP): http://192.168.1.106:${PORT}`);
}
void bootstrap();
