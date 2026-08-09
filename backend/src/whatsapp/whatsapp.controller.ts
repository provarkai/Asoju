import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WhatsappWebhookGuard } from './whatsapp-webhook.guard';
import { WhatsappService } from './whatsapp.service';
import { InboundMessageDto } from './dto/inbound-message.dto';

@UseGuards(WhatsappWebhookGuard)
@Controller('webhooks/whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post()
  handleInbound(@Body() dto: InboundMessageDto) {
    return this.whatsappService.handleInboundMessage(dto.from, dto.body);
  }
}
