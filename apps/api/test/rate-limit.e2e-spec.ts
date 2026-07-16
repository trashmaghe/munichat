import { randomInt } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Express } from 'express';
import { AppModule } from './../src/app.module';

// A random-per-run source IP (spoofed via X-Forwarded-For, honored because
// main.ts-equivalent trust-proxy setup below) keeps this test's throttle
// bucket isolated from auth.e2e-spec.ts's own /auth/login attempts, which
// share the same Redis-backed storage.
function fakeIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // The global throttler skips itself under NODE_ENV==='test' so the other
    // e2e suites (which share one IP and exceed the login limit) aren't 429'd.
    // This suite is the one that actually exercises throttling, so opt back in.
    process.env.THROTTLE_DISABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Restore the default so throttling stays skipped for any suite that runs
    // after this one under --runInBand.
    delete process.env.THROTTLE_DISABLED;
  });

  it('returns 429 on the 6th /auth/login attempt within a minute from the same IP', async () => {
    const ip = fakeIp();

    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ username: 'nosuchuser', password: 'whatever' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username: 'nosuchuser', password: 'whatever' })
      .expect(429);
  });

  it('does not throttle a different IP that has not exceeded its own limit', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ username: 'nosuchuser', password: 'whatever' })
      .expect(401);
  });
});
