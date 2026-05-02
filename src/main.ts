import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*', 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  // app.useGlobalPipes(new ValidationPipe());
  
  // console.log(`\nlink de acesso: \nhttp://localhost:3000/secretaria/criar`)
  // await app.listen(process.env.PORT ?? 3000, '0.0.0.0');


  app.useGlobalPipes(new ValidationPipe());
  
  // Definimos a porta em uma variável para ficar limpo
  const PORT = process.env.PORT ?? 3000;

  await app.listen(PORT, '0.0.0.0');

  console.log(`\n🚀 Backend da Carteirinha Digital rodando!`);
  console.log(`🏠 Local: http://localhost:${PORT}`);
  console.log(`🌐 Rede (seu IP): http://192.168.1.106:${PORT}`);
}
void bootstrap();
