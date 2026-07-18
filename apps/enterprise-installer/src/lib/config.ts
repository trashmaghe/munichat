/**
 * The enterprise installer's configuration model.
 *
 * Everything the IT team enters in the wizard lives here, grouped the same way
 * `.env.example` is. `buildEnvFile` turns it into the exact `.env` the Docker
 * stack (docker/docker-compose.yml + the optional edge overlay) and the NestJS
 * API read at boot — derived values (connection URLs, origins) included, so the
 * operator never has to hand-assemble a DSN.
 */

export type TicketSeverity = 'info' | 'warning' | 'error' | 'off';

export interface EnterpriseConfig {
  // --- Postgres ---
  postgresUser: string;
  postgresPassword: string;
  postgresDb: string;
  postgresPort: string;

  // --- Redis ---
  redisPort: string;

  // --- MinIO (object storage) ---
  minioRootUser: string;
  minioRootPassword: string;
  minioPort: string;
  minioConsolePort: string;
  minioBucket: string;

  // --- Directory (LDAP / Active Directory) ---
  ldapUrl: string;
  ldapBindDn: string;
  ldapBindPassword: string;
  ldapAdminPassword: string;
  ldapBaseDn: string;
  ldapUserSearchBase: string;
  ldapGroupSearchBase: string;
  ldapUsernameAttribute: string;
  ldapUniqueIdAttribute: string;
  ldapPort: string;

  // --- JWT / sessions ---
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;

  // --- GLPI (ticketing) ---
  glpiUrl: string;
  glpiAppToken: string;
  glpiUserToken: string;
  glpiWebhookSecret: string;

  // --- Tactical RMM (device monitoring) ---
  rmmUrl: string;
  rmmApiKey: string;
  rmmWebhookSecret: string;
  rmmAlertChannelName: string;
  rmmAutoTicketSeverity: TicketSeverity;

  // --- Networking / TLS ---
  useEdge: boolean;
  appDomain: string;
  apiDomain: string;
  acmeEmail: string;
  apiPort: string;

  // --- Images (where the installer pulls the app from) ---
  imageRegistry: string;
  imageTag: string;
}

/**
 * Cryptographically strong random secret (URL-safe base64), for JWT secrets
 * and generated passwords. Uses the Web Crypto API available in the installer's
 * WebView.
 */
export function randomSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A password without the base64 punctuation that trips up shell/URL contexts
 * (Postgres DSNs, MinIO). Alphanumeric only.
 */
export function randomPassword(length = 24): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join('');
}

/** A fresh config with sane defaults and freshly generated secrets. */
export function defaultConfig(): EnterpriseConfig {
  return {
    postgresUser: 'elyzian',
    postgresPassword: randomPassword(),
    postgresDb: 'elyzian',
    postgresPort: '5432',

    redisPort: '6379',

    minioRootUser: 'elyzian_admin',
    minioRootPassword: randomPassword(),
    minioPort: '9000',
    minioConsolePort: '9001',
    minioBucket: 'elyzian-files',

    ldapUrl: 'ldap://ad.example.gov.br:389',
    ldapBindDn: 'cn=elyzian-svc,ou=Service Accounts,dc=example,dc=gov,dc=br',
    ldapBindPassword: '',
    ldapAdminPassword: randomPassword(),
    ldapBaseDn: 'dc=example,dc=gov,dc=br',
    ldapUserSearchBase: 'ou=people,dc=example,dc=gov,dc=br',
    ldapGroupSearchBase: 'ou=groups,dc=example,dc=gov,dc=br',
    ldapUsernameAttribute: 'sAMAccountName',
    ldapUniqueIdAttribute: 'objectGUID',
    ldapPort: '389',

    jwtAccessSecret: randomSecret(),
    jwtRefreshSecret: randomSecret(),
    jwtAccessTtl: '900',
    jwtRefreshTtl: '604800',

    glpiUrl: '',
    glpiAppToken: '',
    glpiUserToken: '',
    glpiWebhookSecret: randomSecret(24),

    rmmUrl: '',
    rmmApiKey: '',
    rmmWebhookSecret: randomSecret(24),
    rmmAlertChannelName: 'ti',
    rmmAutoTicketSeverity: 'error',

    useEdge: true,
    appDomain: 'chat.example.gov.br',
    apiDomain: 'api.chat.example.gov.br',
    acmeEmail: 'ti@example.gov.br',
    apiPort: '3000',

    imageRegistry: 'ghcr.io/trashmaghe',
    imageTag: 'latest',
  };
}

/**
 * Derive the browser-facing web origin and API URLs. With the edge (Caddy +
 * Let's Encrypt) enabled the app is served over HTTPS on its own domains;
 * without it, everything is plain HTTP against the API port on the host.
 */
export function derivedUrls(c: EnterpriseConfig): {
  webOrigin: string;
  viteApiUrl: string;
  viteWsUrl: string;
} {
  if (c.useEdge) {
    return {
      webOrigin: `https://${c.appDomain}`,
      viteApiUrl: `https://${c.apiDomain}`,
      viteWsUrl: `wss://${c.apiDomain}`,
    };
  }
  return {
    webOrigin: `http://${c.appDomain || 'localhost'}`,
    viteApiUrl: `http://${c.appDomain || 'localhost'}:${c.apiPort}`,
    viteWsUrl: `ws://${c.appDomain || 'localhost'}:${c.apiPort}`,
  };
}

function line(key: string, value: string): string {
  return `${key}=${value}`;
}

/** Render the config as the `.env` file the Docker stack + API consume. */
export function buildEnvFile(c: EnterpriseConfig): string {
  const databaseUrl = `postgresql://${c.postgresUser}:${c.postgresPassword}@postgres:${c.postgresPort}/${c.postgresDb}?schema=public`;
  const redisUrl = `redis://redis:${c.redisPort}`;
  const { webOrigin, viteApiUrl, viteWsUrl } = derivedUrls(c);

  const sections: string[][] = [
    [
      '# Generated by the Elyzian Enterprise Installer — do not commit.',
      '# Regenerate by re-running the installer; secrets are recreated fresh.',
    ],
    [
      '# --- Postgres ---',
      line('POSTGRES_USER', c.postgresUser),
      line('POSTGRES_PASSWORD', c.postgresPassword),
      line('POSTGRES_DB', c.postgresDb),
      line('POSTGRES_PORT', c.postgresPort),
      line('DATABASE_URL', databaseUrl),
    ],
    ['# --- Redis ---', line('REDIS_PORT', c.redisPort), line('REDIS_URL', redisUrl)],
    [
      '# --- MinIO ---',
      line('MINIO_ROOT_USER', c.minioRootUser),
      line('MINIO_ROOT_PASSWORD', c.minioRootPassword),
      line('MINIO_PORT', c.minioPort),
      line('MINIO_CONSOLE_PORT', c.minioConsolePort),
      line('MINIO_ENDPOINT', 'minio'),
      line('MINIO_USE_SSL', 'false'),
      line('MINIO_BUCKET', c.minioBucket),
    ],
    [
      '# --- LDAP / Active Directory ---',
      line('LDAP_URL', c.ldapUrl),
      line('LDAP_BIND_DN', c.ldapBindDn),
      line('LDAP_BIND_PASSWORD', c.ldapBindPassword),
      line('LDAP_ADMIN_PASSWORD', c.ldapAdminPassword),
      line('LDAP_BASE_DN', c.ldapBaseDn),
      line('LDAP_USER_SEARCH_BASE', c.ldapUserSearchBase),
      line('LDAP_GROUP_SEARCH_BASE', c.ldapGroupSearchBase),
      line('LDAP_USERNAME_ATTRIBUTE', c.ldapUsernameAttribute),
      line('LDAP_UNIQUE_ID_ATTRIBUTE', c.ldapUniqueIdAttribute),
      line('LDAP_PORT', c.ldapPort),
    ],
    [
      '# --- JWT / sessions ---',
      line('JWT_ACCESS_SECRET', c.jwtAccessSecret),
      line('JWT_REFRESH_SECRET', c.jwtRefreshSecret),
      line('JWT_ACCESS_TTL', c.jwtAccessTtl),
      line('JWT_REFRESH_TTL', c.jwtRefreshTtl),
    ],
    ['# --- API ---', line('PORT', c.apiPort), line('NODE_ENV', 'production'), line('WEB_ORIGIN', webOrigin)],
    [
      '# --- GLPI (ticketing) ---',
      line('GLPI_URL', c.glpiUrl),
      line('GLPI_APP_TOKEN', c.glpiAppToken),
      line('GLPI_USER_TOKEN', c.glpiUserToken),
      line('GLPI_WEBHOOK_SECRET', c.glpiWebhookSecret),
      line('GLPI_WEBHOOK_TICKET_ID_FIELD', 'id'),
    ],
    [
      '# --- Tactical RMM (device monitoring/alerting) ---',
      line('RMM_URL', c.rmmUrl),
      line('RMM_API_KEY', c.rmmApiKey),
      line('RMM_WEBHOOK_SECRET', c.rmmWebhookSecret),
      line('RMM_ALERT_CHANNEL_NAME', c.rmmAlertChannelName),
      line('RMM_AUTO_TICKET_SEVERITY', c.rmmAutoTicketSeverity),
    ],
    ['# --- Web (build-time, inlined into the bundle) ---', line('VITE_API_URL', viteApiUrl), line('VITE_WS_URL', viteWsUrl)],
    [
      '# --- Edge / TLS (Caddy + Let’s Encrypt) ---',
      line('APP_DOMAIN', c.appDomain),
      line('API_DOMAIN', c.apiDomain),
      line('ACME_EMAIL', c.acmeEmail),
    ],
    [
      '# --- Images (registry the stack is pulled from) ---',
      line('ELYZIAN_REGISTRY', c.imageRegistry),
      line('ELYZIAN_IMAGE_TAG', c.imageTag),
    ],
  ];

  return sections.map((s) => s.join('\n')).join('\n\n') + '\n';
}

/** Field-level validation. Returns a map of fieldKey → message for anything wrong. */
export function validate(c: EnterpriseConfig): Partial<Record<keyof EnterpriseConfig, string>> {
  const errors: Partial<Record<keyof EnterpriseConfig, string>> = {};
  const required: (keyof EnterpriseConfig)[] = [
    'postgresUser',
    'postgresPassword',
    'postgresDb',
    'minioRootUser',
    'minioRootPassword',
    'ldapUrl',
    'ldapBindDn',
    'ldapBindPassword',
    'ldapBaseDn',
    'jwtAccessSecret',
    'jwtRefreshSecret',
  ];
  for (const key of required) {
    if (!String(c[key]).trim()) errors[key] = 'Required';
  }
  if (c.jwtAccessSecret && c.jwtAccessSecret === c.jwtRefreshSecret) {
    errors.jwtRefreshSecret = 'Must differ from the access secret';
  }
  if (c.useEdge) {
    if (!c.appDomain.trim()) errors.appDomain = 'Required when TLS edge is enabled';
    if (!c.apiDomain.trim()) errors.apiDomain = 'Required when TLS edge is enabled';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.acmeEmail)) errors.acmeEmail = 'A valid email is required for Let’s Encrypt';
  }
  return errors;
}
