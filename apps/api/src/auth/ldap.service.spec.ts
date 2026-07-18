import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LdapService } from './ldap.service';

const mockClientInstance = {
  bind: jest.fn(),
  search: jest.fn(),
  unbind: jest.fn(),
};

jest.mock('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => mockClientInstance),
}));

describe('LdapService', () => {
  let service: LdapService;

  const config: Record<string, string> = {
    LDAP_URL: 'ldap://localhost:1389',
    LDAP_BIND_DN: 'cn=admin,dc=elyzian,dc=local',
    LDAP_BIND_PASSWORD: 'admin-pass',
    LDAP_USER_SEARCH_BASE: 'ou=people,dc=elyzian,dc=local',
    LDAP_USERNAME_ATTRIBUTE: 'uid',
    LDAP_UNIQUE_ID_ATTRIBUTE: 'entryUUID',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LdapService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
      ],
    }).compile();

    service = module.get(LdapService);
  });

  describe('findUserByUsername', () => {
    it('returns a normalized user entry, coercing a single memberOf string into an array', async () => {
      mockClientInstance.search.mockResolvedValue({
        searchEntries: [
          {
            dn: 'uid=jsilva,ou=people,dc=elyzian,dc=local',
            uid: 'jsilva',
            entryUUID: 'uuid-1',
            displayName: 'Joao Silva',
            mail: 'jsilva@elyzian.local',
            departmentNumber: 'TI',
            memberOf: 'cn=ti,ou=groups,dc=elyzian,dc=local',
          },
        ],
      });

      const result = await service.findUserByUsername('jsilva');

      expect(mockClientInstance.bind).toHaveBeenCalledWith(
        'cn=admin,dc=elyzian,dc=local',
        'admin-pass',
      );
      expect(result).toEqual({
        dn: 'uid=jsilva,ou=people,dc=elyzian,dc=local',
        uniqueId: 'uuid-1',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: 'jsilva@elyzian.local',
        department: 'TI',
        memberOf: ['cn=ti,ou=groups,dc=elyzian,dc=local'],
      });
      expect(mockClientInstance.unbind).toHaveBeenCalled();
    });

    it('keeps multiple memberOf values as an array', async () => {
      mockClientInstance.search.mockResolvedValue({
        searchEntries: [
          {
            dn: 'uid=jsilva,ou=people,dc=elyzian,dc=local',
            uid: 'jsilva',
            entryUUID: 'uuid-1',
            displayName: 'Joao Silva',
            memberOf: [
              'cn=ti,ou=groups,dc=elyzian,dc=local',
              'cn=financas,ou=groups,dc=elyzian,dc=local',
            ],
          },
        ],
      });

      const result = await service.findUserByUsername('jsilva');

      expect(result?.memberOf).toEqual([
        'cn=ti,ou=groups,dc=elyzian,dc=local',
        'cn=financas,ou=groups,dc=elyzian,dc=local',
      ]);
    });

    it('returns an empty memberOf array when the user belongs to no groups', async () => {
      mockClientInstance.search.mockResolvedValue({
        searchEntries: [
          {
            dn: 'uid=jsilva,ou=people,dc=elyzian,dc=local',
            uid: 'jsilva',
            entryUUID: 'uuid-1',
            displayName: 'Joao Silva',
          },
        ],
      });

      const result = await service.findUserByUsername('jsilva');

      expect(result?.memberOf).toEqual([]);
    });

    it('returns null when no user matches', async () => {
      mockClientInstance.search.mockResolvedValue({ searchEntries: [] });

      const result = await service.findUserByUsername('unknown');

      expect(result).toBeNull();
      expect(mockClientInstance.unbind).toHaveBeenCalled();
    });

    it('always unbinds even if the search throws', async () => {
      mockClientInstance.search.mockRejectedValue(
        new Error('connection reset'),
      );

      await expect(service.findUserByUsername('jsilva')).rejects.toThrow(
        'connection reset',
      );
      expect(mockClientInstance.unbind).toHaveBeenCalled();
    });
  });

  describe('verifyCredentials', () => {
    it('returns true when the bind succeeds', async () => {
      mockClientInstance.bind.mockResolvedValue(undefined);

      const result = await service.verifyCredentials(
        'uid=jsilva,ou=people,dc=elyzian,dc=local',
        'correct-pass',
      );

      expect(result).toBe(true);
    });

    it('returns false when the bind fails (invalid credentials)', async () => {
      mockClientInstance.bind.mockRejectedValue(
        new Error('Invalid Credentials'),
      );

      const result = await service.verifyCredentials(
        'uid=jsilva,ou=people,dc=elyzian,dc=local',
        'wrong-pass',
      );

      expect(result).toBe(false);
      expect(mockClientInstance.unbind).toHaveBeenCalled();
    });

    it('returns false without attempting a bind when the password is empty', async () => {
      const result = await service.verifyCredentials(
        'uid=jsilva,ou=people,dc=elyzian,dc=local',
        '',
      );

      expect(result).toBe(false);
      expect(mockClientInstance.bind).not.toHaveBeenCalled();
    });
  });
});
