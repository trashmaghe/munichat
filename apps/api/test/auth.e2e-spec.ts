import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { Client, Change, Attribute } from 'ldapts';
import {
  currentUserResponseSchema,
  loginResponseSchema,
} from '@munichat/shared';
import { AppModule } from './../src/app.module';

const FINANCAS_GROUP_DN = 'cn=financas,ou=groups,dc=munichat,dc=local';
const MFERREIRA_DN = 'uid=mferreira,ou=people,dc=munichat,dc=local';

async function removeGroupMember(
  groupDn: string,
  memberDn: string,
): Promise<void> {
  const client = new Client({ url: process.env.LDAP_URL! });
  try {
    await client.bind(
      process.env.LDAP_BIND_DN!,
      process.env.LDAP_BIND_PASSWORD,
    );
    await client.modify(
      groupDn,
      new Change({
        operation: 'delete',
        modification: new Attribute({ type: 'member', values: [memberDn] }),
      }),
    );
  } finally {
    await client.unbind();
  }
}

function extractCookie(
  // @types/superagent types this header as a plain string, but Node's http layer
  // returns an array whenever multiple Set-Cookie headers are present, which is
  // always the case here (both access_token and refresh_token are set together).
  setCookieHeader: string | string[] | undefined,
  name: string,
): string {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Expected a ${name} cookie to be set`);
  }
  return cookie.split(';')[0];
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects an unknown username', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'nosuchuser', password: 'whatever' })
      .expect(401);
  });

  it('rejects a known username with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'jsilva', password: 'wrong-password' })
      .expect(401);
  });

  it('logs in with valid AD credentials, sets cookies, syncs channel membership, and supports /users/me, refresh and logout', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'jsilva', password: 'devpassword123' })
      .expect(200);

    const body = loginResponseSchema.parse(loginRes.body);
    expect(body.user.username).toBe('jsilva');
    expect(body.user.department).toBe('TI');

    const accessCookie = extractCookie(
      loginRes.headers['set-cookie'],
      'access_token',
    );
    const refreshCookie = extractCookie(
      loginRes.headers['set-cookie'],
      'refresh_token',
    );

    // GET /users/me with the forwarded access token cookie
    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', [accessCookie])
      .expect(200);
    expect(currentUserResponseSchema.parse(meRes.body).username).toBe('jsilva');

    // The login-time channel sync created a ChannelMember row for the seeded "ti" group
    const channel = await prisma.channel.findUnique({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local' },
    });
    expect(channel).not.toBeNull();
    const membership = await prisma.channelMember.findUnique({
      where: {
        userId_channelId: { userId: body.user.id, channelId: channel!.id },
      },
    });
    expect(membership).not.toBeNull();

    // POST /auth/refresh rotates both cookies
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [refreshCookie])
      .expect(200);
    const newAccessCookie = extractCookie(
      refreshRes.headers['set-cookie'],
      'access_token',
    );
    const newRefreshCookie = extractCookie(
      refreshRes.headers['set-cookie'],
      'refresh_token',
    );
    // Refresh tokens embed a unique jti, so rotation is always observable there even
    // if the access token payload happens to be byte-identical to the previous one.
    expect(newRefreshCookie).not.toBe(refreshCookie);

    // The old refresh token is single-use: replaying it must fail
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [refreshCookie])
      .expect(401);

    // POST /auth/logout invalidates the current session. Both cookies must be sent
    // together, exactly as a browser would: the guard needs the access token, and
    // the handler needs the refresh token cookie to know which Redis entry to revoke.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', [newAccessCookie, newRefreshCookie])
      .expect(200);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', [newAccessCookie])
      .expect(200); // access token itself is still valid until it expires; logout only revokes the refresh token

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [newRefreshCookie])
      .expect(401); // refresh token was revoked by logout
  });

  it('prunes stale AD-linked channel memberships when a user leaves a group', async () => {
    // mferreira starts in "financas" only; log in once to create the membership,
    // then remove her from the group in LDAP and log in again to verify pruning.
    const firstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'mferreira', password: 'devpassword123' })
      .expect(200);
    const userId = loginResponseSchema.parse(firstLogin.body).user.id;

    const financasChannel = await prisma.channel.findUnique({
      where: { adGroupDn: FINANCAS_GROUP_DN },
    });
    const membershipBefore = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId: financasChannel!.id } },
    });
    expect(membershipBefore).not.toBeNull();

    await removeGroupMember(FINANCAS_GROUP_DN, MFERREIRA_DN);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'mferreira', password: 'devpassword123' })
      .expect(200);

    const membershipAfter = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId: financasChannel!.id } },
    });
    expect(membershipAfter).toBeNull();
  });

  it('rejects malformed login payloads', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: '' })
      .expect(400);
  });
});
