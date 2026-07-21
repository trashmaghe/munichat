import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LdapService } from './ldap.service';

const mockClientInstance = {
  bind: jest.fn(),
  search: jest.fn(),
  unbind: jest.fn().mockResolvedValue(undefined),
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
    it('returns a normalized user entry, deriving department from the parent OU', async () => {
      mockClientInstance.search.mockResolvedValue({
        searchEntries: [
          {
            dn: 'CN=Joao Silva,OU=Tecnologia da Informacao,OU=SEMAD,DC=elyzian,DC=local',
            uid: 'jsilva',
            entryUUID: 'uuid-1',
            displayName: 'Joao Silva',
            mail: 'jsilva@elyzian.local',
          },
        ],
      });

      const result = await service.findUserByUsername('jsilva');

      expect(mockClientInstance.bind).toHaveBeenCalledWith(
        'cn=admin,dc=elyzian,dc=local',
        'admin-pass',
      );
      expect(result).toEqual({
        dn: 'CN=Joao Silva,OU=Tecnologia da Informacao,OU=SEMAD,DC=elyzian,DC=local',
        uniqueId: 'uuid-1',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: 'jsilva@elyzian.local',
        department: 'Tecnologia da Informacao',
        departmentDn: 'OU=Tecnologia da Informacao,OU=SEMAD,DC=elyzian,DC=local',
      });
      expect(mockClientInstance.unbind).toHaveBeenCalled();
    });

    it('returns a null department when the immediate parent is not an OU', async () => {
      mockClientInstance.search.mockResolvedValue({
        searchEntries: [
          {
            dn: 'CN=Joao Silva,CN=Users,DC=elyzian,DC=local',
            uid: 'jsilva',
            entryUUID: 'uuid-1',
            displayName: 'Joao Silva',
          },
        ],
      });

      const result = await service.findUserByUsername('jsilva');

      expect(result?.department).toBeNull();
      expect(result?.departmentDn).toBeNull();
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
