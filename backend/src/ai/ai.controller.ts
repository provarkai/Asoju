import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { ConciergeMessageDto } from './dto/concierge-message.dto';
import { ConciergeFeedbackDto } from './dto/concierge-feedback.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai/concierge')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Roles(Role.CUSTOMER)
  @Post('message')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConciergeMessageDto) {
    return this.aiService.converse(user, dto);
  }

  @Roles(Role.CUSTOMER)
  @Post('feedback')
  recordFeedback(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConciergeFeedbackDto) {
    return this.aiService.recordConciergeFeedback(user, dto);
  }
}

// Tighter than the app-wide default (100 req/60s, app.module.ts) and
// separate from BRUTE_FORCE_THROTTLE (auth.controller.ts) — this one
// isn't guarding against credential guessing, it's bounding real LLM
// spend on a route literally anyone can hit with no account. Configurable
// for the same reason AUTH_THROTTLE_LIMIT/TTL_MS are.
const AI_DEMO_THROTTLE = {
  default: {
    limit: parseInt(process.env.AI_DEMO_THROTTLE_LIMIT ?? '8', 10),
    ttl: parseInt(process.env.AI_DEMO_THROTTLE_TTL_MS ?? '60000', 10),
  },
};

/** Public preview of the AI Concierge for the landing page (try-before-
 * signup demo, asoju-app-main conversion) — deliberately its own
 * unguarded controller rather than a route on AiController above, so
 * "requires a customer session" vs. "anyone on the internet" stays
 * obvious at the class level, same reasoning as AiAssistantController
 * being split out from AiController in the first place. */
@Controller('ai/concierge')
export class AiPublicController {
  constructor(private readonly aiService: AiService) {}

  @Throttle(AI_DEMO_THROTTLE)
  @Post('demo-message')
  sendDemoMessage(@Body() dto: ConciergeMessageDto) {
    return this.aiService.demoConverse(dto);
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
