import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const port = config.get<number>('PORT', 3000);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ECD Backend API')
    .setDescription(
      'Early Childhood Development management system API. ' +
        'Success responses are bare DTO bodies; errors use `{ success, statusCode, message, timestamp }` ' +
        '(plus `entity` / `currentVersion` on optimistic-lock conflicts). ' +
        'List endpoints use offset pagination (`items`, `page`, `pageSize`, `total`, `totalPages`); ' +
        'sync pull uses cursor pagination.',
    )
    .setVersion('1.0')
    .addServer('http://localhost:3000', 'Local development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from POST /api/v1/auth/login (`Authorization: Bearer <accessToken>`).',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
}

bootstrap();
