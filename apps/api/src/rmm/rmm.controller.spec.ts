import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';
import { ChannelsService } from '../channels/channels.service';

describe('RmmController', () => {
  let controller: RmmController;
  let rmmService: { listAgents: jest.Mock; getAgent: jest.Mock };
  let channelsService: { findByName: jest.Mock; isMember: jest.Mock };

  const channel = { id: 'channel-1', name: 'ti' };
  const agent = {
    agentId: 'a1',
    hostname: 'PC-12',
    siteName: 'Sede',
    clientName: 'Prefeitura',
    platform: 'windows',
    status: 'online',
  };

  beforeEach(async () => {
    rmmService = { listAgents: jest.fn(), getAgent: jest.fn() };
    channelsService = { findByName: jest.fn(), isMember: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RmmController,
        { provide: RmmService, useValue: rmmService },
        { provide: ChannelsService, useValue: channelsService },
        {
          provide: ConfigService,
          useValue: { get: () => 'ti' },
        },
      ],
    }).compile();

    controller = module.get(RmmController);
  });

  describe('list', () => {
    it('returns agents for a member of the alert channel', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isMember.mockResolvedValue(true);
      rmmService.listAgents.mockResolvedValue([agent]);

      const result = await controller.list({ id: 'user-1' } as never);

      expect(result).toEqual([agent]);
      expect(channelsService.isMember).toHaveBeenCalledWith(
        'user-1',
        'channel-1',
      );
    });

    it('rejects with 403 when the user is not a member of the alert channel', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isMember.mockResolvedValue(false);

      await expect(
        controller.list({ id: 'user-1' } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rmmService.listAgents).not.toHaveBeenCalled();
    });

    it('rejects with 403 when the alert channel does not exist', async () => {
      channelsService.findByName.mockResolvedValue(null);

      await expect(
        controller.list({ id: 'user-1' } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getOne', () => {
    it('returns the agent when found', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isMember.mockResolvedValue(true);
      rmmService.getAgent.mockResolvedValue(agent);

      const result = await controller.getOne({ id: 'user-1' } as never, 'a1');

      expect(result).toEqual(agent);
    });

    it('rejects with 404 when the agent does not exist', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isMember.mockResolvedValue(true);
      rmmService.getAgent.mockResolvedValue(null);

      await expect(
        controller.getOne({ id: 'user-1' } as never, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
