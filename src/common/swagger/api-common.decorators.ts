import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConflictResponseDto, ErrorResponseDto } from './error-response.dto';

/** Optional device attribution header used on many offline-capable mutating routes. */
export const ApiDeviceIdHeader = () =>
  ApiHeader({
    name: 'x-device-id',
    required: false,
    description:
      'Optional Device registry UUID (`id` from POST /devices/register), not deviceUuid. ' +
      'Merged as body.deviceId ?? header. Invalid/foreign devices typically yield 403 ' +
      '(centers soft-fail to null).',
    schema: { type: 'string', format: 'uuid' },
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  });

/** Standard auth failure responses for JWT-protected routes. */
export const ApiAuthErrors = () =>
  applyDecorators(
    ApiUnauthorizedResponse({
      description: 'Missing or invalid Bearer token',
      type: ErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description: 'Authenticated but role/scope/ownership denied',
      type: ErrorResponseDto,
    }),
  );

/** Common client-error responses for mutating / lookup routes. */
export const ApiStandardClientErrors = () =>
  applyDecorators(
    ApiBadRequestResponse({
      description: 'Validation failed or malformed parameters',
      type: ErrorResponseDto,
    }),
    ApiAuthErrors(),
  );

/** Not-found for :id lookups. */
export const ApiNotFoundError = (entity = 'Resource') =>
  ApiNotFoundResponse({
    description: `${entity} not found or not visible in caller scope`,
    type: ErrorResponseDto,
  });

/** Optimistic-lock / version conflict. */
export const ApiOptimisticLockConflict = () =>
  ApiConflictResponse({
    description:
      'Optimistic lock conflict — client version is stale. Refresh entity and retry with currentVersion.',
    type: ConflictResponseDto,
  });
