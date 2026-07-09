import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'ldapts';

export interface LdapUserEntry {
  dn: string;
  uniqueId: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string | null;
  memberOf: string[];
}

@Injectable()
export class LdapService {
  constructor(private readonly configService: ConfigService) {}

  async findUserByUsername(username: string): Promise<LdapUserEntry | null> {
    const client = new Client({ url: this.url() });
    try {
      await client.bind(this.bindDn(), this.bindPassword());

      const { searchEntries } = await client.search(this.userSearchBase(), {
        scope: 'sub',
        filter: `(${this.usernameAttribute()}=${this.escapeFilterValue(username)})`,
        attributes: [
          this.usernameAttribute(),
          this.uniqueIdAttribute(),
          'displayName',
          'cn',
          'mail',
          'departmentNumber',
          'memberOf',
        ],
      });

      const entry = searchEntries[0];
      if (!entry) {
        return null;
      }

      return {
        dn: entry.dn,
        uniqueId: this.first(entry[this.uniqueIdAttribute()]) ?? entry.dn,
        username: this.first(entry[this.usernameAttribute()]) ?? username,
        displayName:
          this.first(entry.displayName) ?? this.first(entry.cn) ?? username,
        email: this.first(entry.mail) ?? null,
        department: this.first(entry.departmentNumber) ?? null,
        memberOf: this.toArray(entry.memberOf),
      };
    } finally {
      await client.unbind();
    }
  }

  async verifyCredentials(dn: string, password: string): Promise<boolean> {
    if (!password) {
      return false;
    }

    const client = new Client({ url: this.url() });
    try {
      await client.bind(dn, password);
      return true;
    } catch {
      return false;
    } finally {
      await client.unbind();
    }
  }

  private url(): string {
    return this.configService.get<string>('LDAP_URL')!;
  }

  private bindDn(): string {
    return this.configService.get<string>('LDAP_BIND_DN')!;
  }

  private bindPassword(): string {
    return this.configService.get<string>('LDAP_BIND_PASSWORD')!;
  }

  private userSearchBase(): string {
    return this.configService.get<string>('LDAP_USER_SEARCH_BASE')!;
  }

  private usernameAttribute(): string {
    return this.configService.get<string>('LDAP_USERNAME_ATTRIBUTE') ?? 'uid';
  }

  private uniqueIdAttribute(): string {
    return (
      this.configService.get<string>('LDAP_UNIQUE_ID_ATTRIBUTE') ?? 'entryUUID'
    );
  }

  // LDAP attributes come back as a bare string when an entry has exactly one value,
  // and as string[] only when it has more than one — always normalize to an array.
  private toArray(
    value: Buffer | Buffer[] | string[] | string | undefined,
  ): string[] {
    if (value == null) {
      return [];
    }
    return (Array.isArray(value) ? value : [value]).map((item) =>
      item.toString(),
    );
  }

  private first(
    value: Buffer | Buffer[] | string[] | string | undefined,
  ): string | undefined {
    return this.toArray(value)[0];
  }

  private escapeFilterValue(value: string): string {
    return value.replace(
      /[\\*()\0]/g,
      (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
    );
  }
}
