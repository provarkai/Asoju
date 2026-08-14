import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { PartnersController } from './partners.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // For createPartnerContact's account provisioning (AuthService) — no
  // cycle, AuthModule has no imports of its own beyond Passport/JWT.
  imports: [AuthModule],
  providers: [PartnersService],
  controllers: [PartnersController],
  exports: [PartnersService],
})
export class PartnersModule {}
