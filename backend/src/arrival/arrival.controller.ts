import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ArrivalService } from './arrival.service';
import { UpsertArrivalProfileDto } from './dto/upsert-arrival-profile.dto';

@UseGuards(JwtAuthGuard, CaseAccessGuard)
@Controller('cases/:caseId/arrival-profile')
export class ArrivalController {
  constructor(private readonly arrivalService: ArrivalService) {}

  @Get()
  getProfile(@Param('caseId') caseId: string) {
    return this.arrivalService.getProfile(caseId);
  }

  @Post()
  upsertProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: UpsertArrivalProfileDto,
  ) {
    return this.arrivalService.upsertProfile(user, caseId, dto);
  }
}
