import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { MessageHistoryResponse } from '@elyzian/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { MessageHistoryQueryDto } from './dto/message-history-query.dto';
import { MessagesService } from './messages.service';
import { toMessageDto } from './message-response.mapper';

@Controller('channels/:channelId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  private readonly glpiUrl: string;

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    configService: ConfigService,
  ) {
    this.glpiUrl = configService.get<string>('GLPI_URL')!;
  }

  @Get()
  async getHistory(
    @CurrentUser() user: User,
    @Param('channelId') channelId: string,
    @Query() query: MessageHistoryQueryDto,
  ): Promise<MessageHistoryResponse> {
    const isMember = await this.channelsService.isMember(user.id, channelId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this channel');
    }
    const { messages, nextCursor } = await this.messagesService.getHistory(
      channelId,
      {
        cursor: query.cursor,
        limit: query.limit,
      },
    );
    return {
      messages: messages.map((message) => toMessageDto(message, this.glpiUrl)),
      nextCursor,
    };
  }
}
