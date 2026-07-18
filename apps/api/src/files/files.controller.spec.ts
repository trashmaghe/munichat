import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { FilesController, parseByteRange } from './files.controller';
import { FilesService } from './files.service';
import { ChannelsService } from '../channels/channels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('parseByteRange', () => {
  it('parses a fully-specified range', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('treats an open-ended range as running to the last byte', () => {
    expect(parseByteRange('bytes=500-', 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it('parses a suffix range (last N bytes)', () => {
    expect(parseByteRange('bytes=-200', 1000)).toEqual({
      start: 800,
      end: 999,
    });
  });

  it('clamps an end past the object size', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it('reports an unsatisfiable range past the end', () => {
    expect(parseByteRange('bytes=2000-3000', 1000)).toBe('unsatisfiable');
  });

  it('ignores a missing or malformed header (→ full response)', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange('rows=0-10', 1000)).toBeNull();
    expect(parseByteRange('bytes=abc-def', 1000)).toBeNull();
    expect(parseByteRange('bytes=0-10,20-30', 1000)).toBeNull(); // multi-range
  });
});

describe('FilesController — download', () => {
  let controller: FilesController;
  let filesService: {
    getAttachmentForDownload: jest.Mock;
    streamObject: jest.Mock;
    streamObjectRange: jest.Mock;
  };
  let channelsService: { isMember: jest.Mock };

  const attachment = {
    id: 'a1',
    fileName: 'video.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1000,
    objectKey: 'attachments/c1/x-video.mp4',
    message: { channelId: 'c1', deletedAt: null },
  };
  const user = { id: 'user-1' } as never;

  function fakeRes() {
    const headers: Record<string, string> = {};
    return {
      statusCode: 200,
      status: jest.fn(function (this: Response, code: number) {
        (this as unknown as { statusCode: number }).statusCode = code;
        return this;
      }),
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      __headers: headers,
    } as unknown as Response & {
      __headers: Record<string, string>;
      status: jest.Mock;
      setHeader: jest.Mock;
    };
  }

  function fakeReq(range?: string): Request {
    return { headers: range ? { range } : {} } as unknown as Request;
  }

  beforeEach(async () => {
    filesService = {
      getAttachmentForDownload: jest.fn(),
      streamObject: jest.fn().mockResolvedValue('FULL_STREAM'),
      streamObjectRange: jest.fn().mockResolvedValue('RANGE_STREAM'),
    };
    channelsService = { isMember: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FilesService, useValue: filesService },
        { provide: ChannelsService, useValue: channelsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FilesController);
  });

  it('serves the full object with Accept-Ranges when there is no Range header', async () => {
    filesService.getAttachmentForDownload.mockResolvedValue(attachment);
    const res = fakeRes();

    await controller.download(user, 'a1', fakeReq(), res);

    expect(res.__headers['Accept-Ranges']).toBe('bytes');
    expect(res.__headers['Cache-Control']).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(res.status).not.toHaveBeenCalledWith(206);
    expect(filesService.streamObject).toHaveBeenCalledWith(
      attachment.objectKey,
    );
    expect(filesService.streamObjectRange).not.toHaveBeenCalled();
  });

  it('serves 206 Partial Content for a Range request', async () => {
    filesService.getAttachmentForDownload.mockResolvedValue(attachment);
    const res = fakeRes();

    await controller.download(user, 'a1', fakeReq('bytes=0-499'), res);

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.__headers['Content-Range']).toBe('bytes 0-499/1000');
    expect(filesService.streamObjectRange).toHaveBeenCalledWith(
      attachment.objectKey,
      0,
      499,
    );
    expect(filesService.streamObject).not.toHaveBeenCalled();
  });

  it('returns 416 for an unsatisfiable range', async () => {
    filesService.getAttachmentForDownload.mockResolvedValue(attachment);
    const res = fakeRes();

    await controller.download(user, 'a1', fakeReq('bytes=5000-6000'), res);

    expect(res.status).toHaveBeenCalledWith(416);
    expect(res.__headers['Content-Range']).toBe('bytes */1000');
    expect(filesService.streamObjectRange).not.toHaveBeenCalled();
  });

  it('404s a missing or deleted attachment', async () => {
    filesService.getAttachmentForDownload.mockResolvedValue(null);
    await expect(
      controller.download(user, 'a1', fakeReq(), fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s a non-member', async () => {
    filesService.getAttachmentForDownload.mockResolvedValue(attachment);
    channelsService.isMember.mockResolvedValue(false);
    await expect(
      controller.download(user, 'a1', fakeReq(), fakeRes()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
