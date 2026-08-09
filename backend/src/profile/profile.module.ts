import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { CustomerResourcesController } from './customer-resources.controller';

@Module({
  providers: [ProfileService],
  controllers: [ProfileController, CustomerResourcesController],
  exports: [ProfileService],
})
export class ProfileModule {}
