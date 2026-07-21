import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'ldapts';

export interface LdapUserEntry {
  dn: string;
  uniqueId: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string | null;
  departmentDn: string | null;
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

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
        ],
      });

      const entry = searchEntries[0];
      if (!entry) {
        return null;
      }

      // Department comes from where the account itself sits in the OU tree,
      // not an AD security group - no group/GPO changes needed in AD for a
      // department channel to exist, it just needs the account placed in the
      // right OU (which it already is).
      const department = this.departmentFromDn(entry.dn.toString());

      return {
        dn: entry.dn,
        uniqueId: this.first(entry[this.uniqueIdAttribute()]) ?? entry.dn,
        username: this.first(entry[this.usernameAttribute()]) ?? username,
        displayName:
          this.first(entry.displayName) ?? this.first(entry.cn) ?? username,
        email: this.first(entry.mail) ?? null,
        department: department?.name ?? null,
        departmentDn: department?.dn ?? null,
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
    } catch (err) {
      this.logger.warn(
        `Bind failed for dn="${dn}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      await client.unbind().catch(() => {});
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

  // The account's department is its immediate parent OU - e.g. for
  // "CN=Higor Leão,OU=Tecnologia da Informacao,OU=SEMAD,...", that's
  // "Tecnologia da Informacao". Returns null when the immediate parent isn't
  // an OU at all (e.g. built-in containers like CN=Users), since there's no
  // department to derive there.
  private departmentFromDn(dn: string): { dn: string; name: string } | null {
    const rdns = this.splitDn(dn);
    const parentRdn = rdns[1];
    if (!parentRdn) {
      return null;
    }

    const match = /^OU=(.+)$/i.exec(parentRdn);
    if (!match) {
      return null;
    }

    return {
      dn: rdns.slice(1).join(','),
      name: this.unescapeDnValue(match[1]),
    };
  }

  // Splits a DN into its RDN components on unescaped commas - LDAP DNs
  // escape a literal comma inside a value as "\,", which must not be treated
  // as a component separator.
  private splitDn(dn: string): string[] {
    return dn.split(/(?<!\\),/).map((rdn) => rdn.trim());
  }

  private unescapeDnValue(value: string): string {
    return value.replace(/\\(.)/g, '$1');
  }

  private escapeFilterValue(value: string): string {
    return value.replace(
      /[\\*()\0]/g,
      (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
    );
  }
}
