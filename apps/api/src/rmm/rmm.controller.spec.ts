import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';
import { ChannelsService } from '../channels/channels.service';
import { AuditService } from '../audit/audit.service';

describe('RmmController', () => {
  let controller: RmmController;
  let rmmService: {
    listAgents: jest.Mock;
    getAgent: jest.Mock;
    getMeshControlUrls: jest.Mock;
  };
  let channelsService: {
    findByName: jest.Mock;
    isMember: jest.Mock;
    isChannelAdmin: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  const channel = { id: 'channel-1', name: 'ti' };
  const agent = {
    agentId: 'a1',
    hostname: 'PC-12',
    siteName: 'Sede',
    clientName: 'Prefeitura',
    platform: 'windows',
    status: 'online',
  };
  const controlUrls = {
    desktopUrl: 'https://mesh.example.org/control?login=abc',
    terminalUrl: 'https://mesh.example.org/terminal?login=abc',
    fileUrl: 'https://mesh.example.org/files?login=abc',
  };

  beforeEach(async () => {
    rmmService = {
      listAgents: jest.fn(),
      getAgent: jest.fn(),
      getMeshControlUrls: jest.fn(),
    };
    channelsService = {
      findByName: jest.fn(),
      isMember: jest.fn(),
      isChannelAdmin: jest.fn(),
    };
    auditService = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RmmController,
        { provide: RmmService, useValue: rmmService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: AuditService, useValue: auditService },
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

  describe('getRemoteControl', () => {
    function fakeRequest(): { ip: string } {
      return { ip: '10.0.0.5' };
    }

    it('returns control URLs and writes an audit log entry for a channel admin', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isChannelAdmin.mockResolvedValue(true);
      rmmService.getMeshControlUrls.mockResolvedValue(controlUrls);

      const result = await controller.getRemoteControl(
        { id: 'user-1' } as never,
        'a1',
        fakeRequest() as never,
      );

      expect(result).toEqual(controlUrls);
      expect(channelsService.isChannelAdmin).toHaveBeenCalledWith(
        'user-1',
        'channel-1',
      );
      expect(rmmService.getMeshControlUrls).toHaveBeenCalledWith('a1');
      expect(auditService.log).toHaveBeenCalledWith(
        'rmm.remote_control.requested',
        { userId: 'user-1', metadata: { agentId: 'a1' }, ip: '10.0.0.5' },
      );
    });

    it('rejects with 403 for a plain member (not a channel admin)', async () => {
      channelsService.findByName.mockResolvedValue(channel);
      channelsService.isChannelAdmin.mockResolvedValue(false);

      await expect(
        controller.getRemoteControl(
          { id: 'user-1' } as never,
          'a1',
          fakeRequest() as never,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rmmService.getMeshControlUrls).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('rejects with 403 when the alert channel does not exist', async () => {
      channelsService.findByName.mockResolvedValue(null);

      await expect(
        controller.getRemoteControl(
          { id: 'user-1' } as never,
          'a1',
          fakeRequest() as never,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rmmService.getMeshControlUrls).not.toHaveBeenCalled();
    });
  });
});
