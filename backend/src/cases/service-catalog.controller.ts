import { Controller, Get } from '@nestjs/common';
import { listServiceFamilies } from './service-family';

/**
 * Public, unauthenticated — the homepage/service pages that would
 * consume this are themselves anonymous marketing surfaces, same
 * reasoning as `AiPublicController`'s `demo-message`. Read-only,
 * computed from a small in-memory map, no cost or abuse concern (unlike
 * an AI call), so no throttle either.
 */
@Controller('service-families')
export class ServiceCatalogController {
  @Get()
  list() {
    return listServiceFamilies();
  }
}
