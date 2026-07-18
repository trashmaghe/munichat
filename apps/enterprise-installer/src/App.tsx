import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsphodelMark } from './brand';
import { Field, Select, SecretField, Toggle } from './components';
import {
  buildEnvFile,
  defaultConfig,
  randomPassword,
  randomSecret,
  validate,
  type EnterpriseConfig,
} from './lib/config';
import {
  deployStack,
  preflight,
  stackHealth,
  writeEnvFile,
  type DeployLogLine,
  type PreflightReport,
} from './lib/tauri';

type StepId = 'welcome' | 'database' | 'storage' | 'directory' | 'integrations' | 'network' | 'review' | 'deploy';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Preflight' },
  { id: 'database', label: 'Database & cache' },
  { id: 'storage', label: 'Object storage' },
  { id: 'directory', label: 'Directory (LDAP)' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'network', label: 'Networking & TLS' },
  { id: 'review', label: 'Review' },
  { id: 'deploy', label: 'Deploy' },
];

export function App() {
  const [config, setConfig] = useState<EnterpriseConfig>(defaultConfig);
  const [stepIndex, setStepIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);

  const step = STEPS[stepIndex].id;
  const errors = useMemo(() => validate(config), [config]);
  const set = useCallback(
    <K extends keyof EnterpriseConfig>(key: K, value: EnterpriseConfig[K]) =>
      setConfig((c) => ({ ...c, [key]: value })),
    [],
  );

  function goTo(index: number) {
    setStepIndex(index);
    setMaxVisited((m) => Math.max(m, index));
  }
  const next = () => goTo(Math.min(stepIndex + 1, STEPS.length - 1));
  const back = () => goTo(Math.max(stepIndex - 1, 0));

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-brand">
          <AsphodelMark className="mark" title="Elyzian" />
          <div>
            <div className="name">Elyzian</div>
            <div className="sub">Enterprise Setup</div>
          </div>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="step-item"
                data-state={i === stepIndex ? 'active' : i < stepIndex ? 'done' : undefined}
                disabled={i > maxVisited}
                onClick={() => i <= maxVisited && setStepIndex(i)}
              >
                <span className="step-dot">{i < stepIndex ? '✓' : i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="rail-foot">Prefeitura Municipal de Nova Serrana</div>
      </nav>

      <main className="content">
        <div className="panel">
          {step === 'welcome' && <WelcomeStep onReady={next} />}
          {step === 'database' && <DatabaseStep config={config} set={set} errors={errors} />}
          {step === 'storage' && <StorageStep config={config} set={set} errors={errors} />}
          {step === 'directory' && <DirectoryStep config={config} set={set} errors={errors} />}
          {step === 'integrations' && <IntegrationsStep config={config} set={set} />}
          {step === 'network' && <NetworkStep config={config} set={set} errors={errors} />}
          {step === 'review' && <ReviewStep config={config} errors={errors} />}
          {step === 'deploy' && <DeployStep config={config} />}

          {step !== 'welcome' && step !== 'deploy' && (
            <div className="footer-bar">
              <button className="btn btn-ghost" onClick={back}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={next}
                disabled={step === 'review' && Object.keys(errors).length > 0}
              >
                {step === 'review' ? 'Deploy →' : 'Continue'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

type StepProps = {
  config: EnterpriseConfig;
  set: <K extends keyof EnterpriseConfig>(key: K, value: EnterpriseConfig[K]) => void;
  errors: Partial<Record<keyof EnterpriseConfig, string>>;
};

function WelcomeStep({ onReady }: { onReady: () => void }) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [checking, setChecking] = useState(true);

  const run = useCallback(async () => {
    setChecking(true);
    setReport(await preflight());
    setChecking(false);
  }, []);
  useEffect(() => {
    void run();
  }, [run]);

  const ready = report?.dockerInstalled && report.dockerRunning && report.composeAvailable;

  return (
    <>
      <span className="eyebrow">Welcome</span>
      <h1>Deploy Elyzian to this server</h1>
      <p className="lede">
        This installer collects everything Elyzian needs — directory, storage, ticketing and
        monitoring credentials, and TLS — writes the environment file, and brings the whole stack
        up with Docker Compose. Nothing leaves this machine.
      </p>

      <div className="section-label">Preflight</div>
      <div className="card">
        <CheckRow
          state={checking ? 'pending' : report?.dockerInstalled ? 'ok' : 'bad'}
          label="Docker Engine installed"
          detail={report?.dockerVersion ?? (checking ? 'Checking…' : 'Not found — install Docker Desktop for Windows Server')}
        />
        <CheckRow
          state={checking ? 'pending' : report?.dockerRunning ? 'ok' : 'bad'}
          label="Docker daemon running"
          detail={report?.dockerRunning ? 'Responding to commands' : 'Start Docker and re-check'}
        />
        <CheckRow
          state={checking ? 'pending' : report?.composeAvailable ? 'ok' : 'bad'}
          label="Docker Compose v2 available"
          detail={report?.composeAvailable ? 'docker compose' : 'Compose plugin missing'}
        />
        <CheckRow
          state={checking ? 'pending' : report?.repoDir ? 'ok' : 'bad'}
          label="Elyzian stack located"
          detail={report?.repoDir ?? 'docker-compose.yml not found next to the installer'}
        />
      </div>

      {!ready && !checking && (
        <div className="banner warn" style={{ marginTop: 16 }}>
          <span>⚠</span>
          <span>
            One or more prerequisites are missing. Install/start Docker, then re-check. The wizard
            still lets you prepare the configuration offline.
          </span>
        </div>
      )}

      <div className="footer-bar">
        <button className="btn btn-ghost" onClick={() => void run()} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </button>
        <button className="btn btn-primary" onClick={onReady}>
          {ready ? 'Continue' : 'Continue anyway'}
        </button>
      </div>
    </>
  );
}

function CheckRow({ state, label, detail }: { state: 'ok' | 'bad' | 'pending'; label: string; detail?: string }) {
  return (
    <div className="check-row">
      <span className={`check-icon ${state}`}>{state === 'ok' ? '✓' : state === 'bad' ? '✕' : '…'}</span>
      <div className="grow">
        <div>{label}</div>
        {detail ? <div className="detail">{detail}</div> : null}
      </div>
    </div>
  );
}

function DatabaseStep({ config, set, errors }: StepProps) {
  return (
    <>
      <span className="eyebrow">Step 1</span>
      <h1>Database &amp; cache</h1>
      <p className="lede">
        Postgres stores every message, channel and user; Redis backs presence and the job queue.
        Both run inside the stack — the generated password stays on this server.
      </p>
      <div className="section-label">PostgreSQL</div>
      <div className="grid">
        <Field label="User" value={config.postgresUser} onChange={(v) => set('postgresUser', v)} error={errors.postgresUser} />
        <Field label="Database" value={config.postgresDb} onChange={(v) => set('postgresDb', v)} error={errors.postgresDb} />
        <SecretField
          label="Password"
          value={config.postgresPassword}
          onChange={(v) => set('postgresPassword', v)}
          onRegenerate={() => set('postgresPassword', randomPassword())}
          error={errors.postgresPassword}
        />
        <Field label="Port (host)" type="number" value={config.postgresPort} onChange={(v) => set('postgresPort', v)} />
      </div>
      <div className="section-label">Redis</div>
      <div className="grid">
        <Field label="Port (host)" type="number" value={config.redisPort} onChange={(v) => set('redisPort', v)} />
      </div>
    </>
  );
}

function StorageStep({ config, set, errors }: StepProps) {
  return (
    <>
      <span className="eyebrow">Step 2</span>
      <h1>Object storage</h1>
      <p className="lede">
        MinIO holds every uploaded file — images, PDFs, and voice notes — S3-compatible and
        self-hosted. The console port is for administration only.
      </p>
      <div className="grid">
        <Field label="Root user" value={config.minioRootUser} onChange={(v) => set('minioRootUser', v)} error={errors.minioRootUser} />
        <Field label="Bucket" value={config.minioBucket} onChange={(v) => set('minioBucket', v)} />
        <SecretField
          label="Root password"
          value={config.minioRootPassword}
          onChange={(v) => set('minioRootPassword', v)}
          onRegenerate={() => set('minioRootPassword', randomPassword())}
          error={errors.minioRootPassword}
        />
        <Field label="API port (host)" type="number" value={config.minioPort} onChange={(v) => set('minioPort', v)} />
        <Field label="Console port (host)" type="number" value={config.minioConsolePort} onChange={(v) => set('minioConsolePort', v)} />
      </div>
    </>
  );
}

function DirectoryStep({ config, set, errors }: StepProps) {
  return (
    <>
      <span className="eyebrow">Step 3</span>
      <h1>Directory (LDAP / Active Directory)</h1>
      <p className="lede">
        Staff sign in with their existing network accounts. Point Elyzian at your domain controller
        and give it a read-only service account to bind with.
      </p>
      <div className="grid">
        <Field
          label="LDAP URL"
          full
          mono
          value={config.ldapUrl}
          onChange={(v) => set('ldapUrl', v)}
          error={errors.ldapUrl}
          hint="e.g. ldap://ad.prefeitura.gov.br:389 (or ldaps:// for TLS)"
        />
        <Field
          label="Bind DN (service account)"
          full
          mono
          value={config.ldapBindDn}
          onChange={(v) => set('ldapBindDn', v)}
          error={errors.ldapBindDn}
        />
        <Field
          label="Bind password"
          type="password"
          full
          value={config.ldapBindPassword}
          onChange={(v) => set('ldapBindPassword', v)}
          error={errors.ldapBindPassword}
        />
        <Field label="Base DN" full mono value={config.ldapBaseDn} onChange={(v) => set('ldapBaseDn', v)} error={errors.ldapBaseDn} />
        <Field label="User search base" mono value={config.ldapUserSearchBase} onChange={(v) => set('ldapUserSearchBase', v)} />
        <Field label="Group search base" mono value={config.ldapGroupSearchBase} onChange={(v) => set('ldapGroupSearchBase', v)} />
        <Field
          label="Username attribute"
          value={config.ldapUsernameAttribute}
          onChange={(v) => set('ldapUsernameAttribute', v)}
          hint="Active Directory: sAMAccountName · OpenLDAP: uid"
        />
        <Field
          label="Unique-ID attribute"
          value={config.ldapUniqueIdAttribute}
          onChange={(v) => set('ldapUniqueIdAttribute', v)}
          hint="AD: objectGUID · OpenLDAP: entryUUID"
        />
      </div>
    </>
  );
}

function IntegrationsStep({ config, set }: Omit<StepProps, 'errors'>) {
  return (
    <>
      <span className="eyebrow">Step 4</span>
      <h1>Integrations</h1>
      <p className="lede">
        Optional. Connect GLPI so <code>/ticket</code> opens real tickets, and Tactical RMM so
        device alerts post into a channel. Leave blank to skip — you can wire these up later.
      </p>
      <div className="section-label">GLPI (ticketing)</div>
      <div className="grid">
        <Field label="GLPI URL" full mono value={config.glpiUrl} onChange={(v) => set('glpiUrl', v)} placeholder="https://glpi.prefeitura.gov.br" />
        <Field label="App token" mono value={config.glpiAppToken} onChange={(v) => set('glpiAppToken', v)} />
        <Field label="User token" mono value={config.glpiUserToken} onChange={(v) => set('glpiUserToken', v)} />
        <SecretField
          label="Webhook secret"
          value={config.glpiWebhookSecret}
          onChange={(v) => set('glpiWebhookSecret', v)}
          onRegenerate={() => set('glpiWebhookSecret', randomSecret(24))}
          hint="Verifies incoming ticket-status webhooks. Leave set unless GLPI can't sign them."
        />
      </div>
      <div className="section-label">Tactical RMM (monitoring)</div>
      <div className="grid">
        <Field label="RMM URL" full mono value={config.rmmUrl} onChange={(v) => set('rmmUrl', v)} placeholder="https://api.rmm.prefeitura.gov.br" />
        <Field label="API key" mono value={config.rmmApiKey} onChange={(v) => set('rmmApiKey', v)} />
        <SecretField
          label="Webhook secret"
          value={config.rmmWebhookSecret}
          onChange={(v) => set('rmmWebhookSecret', v)}
          onRegenerate={() => set('rmmWebhookSecret', randomSecret(24))}
        />
        <Field label="Alert channel" value={config.rmmAlertChannelName} onChange={(v) => set('rmmAlertChannelName', v)} hint="Channel name alerts post into" />
        <Select
          label="Auto-open ticket at severity"
          value={config.rmmAutoTicketSeverity}
          onChange={(v) => set('rmmAutoTicketSeverity', v as EnterpriseConfig['rmmAutoTicketSeverity'])}
          options={[
            { value: 'off', label: 'Off — never' },
            { value: 'info', label: 'Info and above' },
            { value: 'warning', label: 'Warning and above' },
            { value: 'error', label: 'Error only' },
          ]}
        />
      </div>
    </>
  );
}

function NetworkStep({ config, set, errors }: StepProps) {
  return (
    <>
      <span className="eyebrow">Step 5</span>
      <h1>Networking &amp; TLS</h1>
      <p className="lede">
        With the edge enabled, Caddy fronts the stack and provisions trusted Let’s Encrypt
        certificates automatically for your domains. Point both domains at this server first.
      </p>
      <div className="card" style={{ marginBottom: 18 }}>
        <Toggle label="Enable the Caddy TLS edge (recommended for production)" checked={config.useEdge} onChange={(v) => set('useEdge', v)} />
      </div>
      <div className="grid">
        <Field label="App domain" mono value={config.appDomain} onChange={(v) => set('appDomain', v)} error={errors.appDomain} hint="Where staff open Elyzian" />
        <Field label="API domain" mono value={config.apiDomain} onChange={(v) => set('apiDomain', v)} error={errors.apiDomain} hint="REST + WebSocket origin" />
        <Field label="ACME email" type="email" value={config.acmeEmail} onChange={(v) => set('acmeEmail', v)} error={errors.acmeEmail} hint="Let’s Encrypt expiry notices" />
        <Field label="API port (host)" type="number" value={config.apiPort} onChange={(v) => set('apiPort', v)} />
      </div>
    </>
  );
}

function ReviewStep({ config, errors }: { config: EnterpriseConfig; errors: StepProps['errors'] }) {
  const env = buildEnvFile(config);
  const errorCount = Object.keys(errors).length;
  // Mask obvious secrets in the preview.
  const masked = env.replace(
    /^(POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD|LDAP_BIND_PASSWORD|LDAP_ADMIN_PASSWORD|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|GLPI_WEBHOOK_SECRET|RMM_WEBHOOK_SECRET|RMM_API_KEY|GLPI_APP_TOKEN|GLPI_USER_TOKEN)=(.+)$/gm,
    (_m, k: string, v: string) => `${k}=${v ? '••••••••' + v.slice(-4) : ''}`,
  );

  return (
    <>
      <span className="eyebrow">Step 6</span>
      <h1>Review the configuration</h1>
      <p className="lede">
        This is the <code>.env</code> the stack will run with (secrets masked). Deploying writes it
        to the stack directory and runs Docker Compose.
      </p>
      {errorCount > 0 ? (
        <div className="banner err" style={{ marginBottom: 16 }}>
          <span>✕</span>
          <span>
            {errorCount} field{errorCount > 1 ? 's need' : ' needs'} attention before you can deploy.
            Use the steps on the left to fix them.
          </span>
        </div>
      ) : (
        <div className="banner ok" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>Configuration looks complete. Ready to deploy.</span>
        </div>
      )}
      <pre className="env-preview">{masked}</pre>
    </>
  );
}

function DeployStep({ config }: { config: EnterpriseConfig }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [log, setLog] = useState<DeployLogLine[]>([]);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [log]);

  async function run() {
    setPhase('running');
    setLog([{ stream: 'status', line: 'Writing .env and starting the stack…' }]);
    const repoDir = '.';
    try {
      await writeEnvFile(repoDir, buildEnvFile(config));
      const result = await deployStack(repoDir, config.useEdge, (line) => setLog((l) => [...l, line]));
      if (result.ok) {
        setPhase('done');
        const { viteApiUrl } = { viteApiUrl: config.useEdge ? `https://${config.apiDomain}` : `http://localhost:${config.apiPort}` };
        setHealthy(await stackHealth(viteApiUrl));
      } else {
        setPhase('failed');
      }
    } catch (err) {
      setLog((l) => [...l, { stream: 'stderr', line: err instanceof Error ? err.message : String(err) }]);
      setPhase('failed');
    }
  }

  return (
    <>
      <span className="eyebrow">Step 7</span>
      <h1>Deploy</h1>
      <p className="lede">
        Elyzian will start Postgres, Redis, MinIO, the API and the web app{config.useEdge ? ', behind the Caddy TLS edge' : ''}.
        First boot pulls images and runs database migrations — give it a minute.
      </p>

      {phase === 'idle' && (
        <button className="btn btn-primary" onClick={() => void run()}>
          Start deployment
        </button>
      )}

      {phase !== 'idle' && (
        <>
          <div className="console" ref={consoleRef}>
            {log.map((l, i) => (
              <div key={i} className={l.stream}>
                {l.stream === 'stderr' ? '! ' : l.stream === 'status' ? '» ' : '  '}
                {l.line}
              </div>
            ))}
          </div>

          {phase === 'done' && (
            <div className={`banner ${healthy ? 'ok' : 'warn'}`} style={{ marginTop: 16 }}>
              <span>{healthy ? '✓' : '…'}</span>
              <span>
                {healthy
                  ? `Elyzian is up and answering at ${config.useEdge ? `https://${config.appDomain}` : `port ${config.apiPort}`}.`
                  : 'Stack started. The API health check hasn’t passed yet — it may still be migrating; check the logs above.'}
              </span>
            </div>
          )}
          {phase === 'failed' && (
            <div className="banner err" style={{ marginTop: 16 }}>
              <span>✕</span>
              <span>Deployment did not complete. Review the log above, fix the issue, and retry.</span>
            </div>
          )}
          {(phase === 'done' || phase === 'failed') && (
            <div className="footer-bar">
              <span className="hint" />
              <button className="btn btn-primary" onClick={() => void run()}>
                {phase === 'failed' ? 'Retry deployment' : 'Re-run'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
