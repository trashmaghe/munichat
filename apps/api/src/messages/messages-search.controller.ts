import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { MessageSearchResponse } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { MessageSearchQueryDto } from './dto/message-search-query.dto';
import { MessagesService } from './messages.service';
import { toMessageDto } from './message-response.mapper';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesSearchController {
  private readonly glpiUrl: string;

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    configService: ConfigService,
  ) {
    this.glpiUrl = configService.get<string>('GLPI_URL')!;
  }

  @Get('search')
  async search(
    @CurrentUser() user: User,
    @Query() query: MessageSearchQueryDto,
  ): Promise<MessageSearchResponse> {
    const channelIds = await this.resolveSearchScope(user.id, query.channelId);

    const { messages, nextCursor } = await this.messagesService.search({
      query: query.q,
      channelIds,
      cursor: query.cursor,
      limit: query.limit,
    });

    return {
      messages: messages.map((message) => toMessageDto(message, this.glpiUrl)),
      nextCursor,
    };
  }

  private async resolveSearchScope(
    userId: string,
    channelId: string | undefined,
  ): Promise<string[]> {
    if (channelId) {
      const isMember = await this.channelsService.isMember(userId, channelId);
      if (!isMember) {
        throw new ForbiddenException('You are not a member of this channel');
      }
      return [channelId];
    }

    const channels = await this.channelsService.listForUser(userId);
    return channels.map((channel) => channel.id);
  }
}
