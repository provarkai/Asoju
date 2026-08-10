import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { ConciergeMessageDto } from './dto/concierge-message.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai/concierge')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Roles(Role.CUSTOMER)
  @Post('message')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConciergeMessageDto) {
    return this.aiService.converse(user, dto);
  }
}

/** Section 12 P2 "personal AI assistant" — deliberately its own controller
 * (not a new method on AiController above) so the intake Concierge and the
 * existing-customer assistant are obviously two different surfaces. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai/assistant')
export class AiAssistantController {
  constructor(private readonly aiService: AiService) {}

  @Roles(Role.CUSTOMER)
  @Post('message')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConciergeMessageDto) {
    return this.aiService.assistantReply(user, dto);
  }
}
