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

  // Required for browser CORS preflight: browser sends OPTIONS before certain cross-origin requests.
  // Without this, Express will respond 404 for OPTIONS and the browser will block the real POST.
  app.enableCors({
    origin: true, // Reflect the requesting Origin header
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id'],
  });

  // Prefer explicit public URL; Render injects RENDER_EXTERNAL_URL on hosted services.
  // Relative "/" makes Swagger "Try it out" use the same host that serves /docs.
  const publicApiUrl = (
    config.get<string>('PUBLIC_API_URL') ||
    config.get<string>('RENDER_EXTERNAL_URL') ||
    ''
  ).replace(/\/$/, '');

  const swaggerBuilder = new DocumentBuilder()
    .setTitle('ECD Backend API')
    .setDescription(
      'Early Childhood Development management system API. ' +
        'Success responses are bare DTO bodies; errors use `{ success, statusCode, message, timestamp }` ' +
        '(plus `entity` / `currentVersion` on optimistic-lock conflicts). ' +
        'List endpoints use offset pagination (`items`, `page`, `pageSize`, `total`, `totalPages`); ' +
        'sync pull uses cursor pagination.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from POST /api/v1/auth/login (`Authorization: Bearer <accessToken>`).',
      },
      'bearer',
    );

  if (publicApiUrl) {
    swaggerBuilder.addServer(publicApiUrl, 'API');
  } else {
    swaggerBuilder.addServer('/', 'Current host');
  }

  const document = SwaggerModule.createDocument(app, swaggerBuilder.build());
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
}

bootstrap();
