import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Roles(Role.CUSTOMER)
@Controller('cases/:caseId/rating')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratingsService.rateCase(user, caseId, dto.stars, dto.comment);
  }
}
