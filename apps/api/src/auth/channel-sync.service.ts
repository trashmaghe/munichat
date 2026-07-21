import { Injectable } from '@nestjs/common';
import { ChannelType, MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LdapDepartment {
  dn: string;
  name: string;
}

@Injectable()
export class ChannelSyncService {
  constructor(private readonly prisma: PrismaService) {}

  // Keeps ChannelMember rows in lockstep with the user's current AD
  // department (the OU their account sits in, e.g. "Tecnologia da
  // Informacao") - joins its channel, and leaves the AD-linked channel for
  // whatever department they were previously synced into if it changed.
  // Channels without an adGroupDn (not AD-linked) are never touched by this
  // sync. `department` is null when the account isn't under a derivable OU.
  //
  // This runs on every login and must be safe when the *same* user logs in
  // concurrently (e.g. two browser tabs, or parallel e2e workers hitting the
  // shared seeded accounts). Prisma's `upsert` is not atomic — it emits a
  // SELECT followed by an INSERT — so two concurrent syncs can both decide to
  // INSERT the same (userId, channelId) and the loser hits a duplicate-key
  // violation (ChannelMember_pkey, P2002). We avoid that by using conflict-safe
  // writes (`INSERT ... ON CONFLICT DO NOTHING`) instead of read-then-write.
  async syncChannelsForUser(
    userId: string,
    department: LdapDepartment | null,
  ): Promise<void> {
    if (department) {
      const channel = await this.ensureChannel(department);
      // createMany + skipDuplicates compiles to ON CONFLICT DO NOTHING, which is
      // atomic at the DB level. The desired end state is simply "the membership
      // row exists"; the old upsert only ever did `update: {}` (a no-op), so
      // skipping an already-present row preserves the exact previous behaviour
      // while removing the race.
      await this.prisma.channelMember.createMany({
        data: [{ userId, channelId: channel.id, role: MemberRole.MEMBER }],
        skipDuplicates: true,
      });
    }

    await this.prisma.channelMember.deleteMany({
      where: {
        userId,
        channel: {
          adGroupDn: { not: null, notIn: department ? [department.dn] : [] },
        },
      },
    });
  }

  // Upsert the AD-linked channel, tolerating a concurrent creator: if two logins
  // race to create the same adGroupDn, one wins and the other catches the unique
  // violation and re-reads the now-existing row instead of surfacing a 500.
  private async ensureChannel(
    department: LdapDepartment,
  ): Promise<{ id: string }> {
    try {
      return await this.prisma.channel.upsert({
        where: { adGroupDn: department.dn },
        create: {
          name: this.slug(department.name),
          displayName: department.name,
          type: ChannelType.DEPARTMENT,
          adGroupDn: department.dn,
        },
        update: {},
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.channel.findUniqueOrThrow({
          where: { adGroupDn: department.dn },
          select: { id: true },
        });
      }
      throw error;
    }
  }

  private slug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
