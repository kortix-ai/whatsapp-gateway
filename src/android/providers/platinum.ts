import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Platinum, type Sandbox, type SandboxState } from '@platinum-dev/sdk';
import { config } from '../../config.js';
import type {
  AndroidControlAction,
  AndroidRuntimeHealth,
  AndroidRuntimeProvider,
  ProvisionAndroidRuntimeInput,
  ProvisionedAndroidRuntime,
  UpgradeAndroidRuntimeInput,
} from '../types.js';

const CONTROL_CONFIG_PATH = '/var/lib/android-control/config.json';
const CONTROL_SOURCE_PATH = '/usr/local/lib/platinum-android-control/server.mjs';
const CONTROL_LAUNCHER_PATH = '/usr/local/sbin/platinum-android-control';
const EXTRA_SERVICES_PATH = '/usr/local/sbin/platinum-extra-services';
const ANDROID_LAUNCHER_PATH = '/usr/local/sbin/platinum-android';
const ANDROID_PROXY_PATH = '/var/lib/android-network/http-proxy-url';
const APPIUM_PORT = 4723;

function randomVncPassword(): string {
  // Classic VNC authentication uses only the first eight bytes.
  return randomBytes(6).toString('base64url');
}

function randomControlToken(): string {
  return randomBytes(32).toString('base64url');
}

function proxyFor(input: ProvisionAndroidRuntimeInput): string | undefined {
  const candidate = input.proxyUrl
    ?? config.PLATINUM_ANDROID_PROXY_URL
    ?? config.WA_PROXY_URL;
  if (!candidate) return undefined;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) {
    if (input.proxyUrl || config.PLATINUM_ANDROID_PROXY_URL) {
      throw new Error('Native Android proxy must use http:// or https://');
    }
    return undefined;
  }
  return url.toString();
}

function publicProxyMetadata(value: string | undefined): Record<string, unknown> {
  if (!value) return { configured: false };
  const url = new URL(value);
  return {
    configured: true,
    protocol: url.protocol.replace(':', ''),
    host: url.hostname,
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    authenticated: Boolean(url.username || url.password),
  };
}

function providerState(state: SandboxState['state']): AndroidRuntimeHealth['provider_state'] {
  return state;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function checked(result: Promise<{ check(): unknown }>): Promise<void> {
  (await result).check();
}

export class PlatinumAndroidRuntimeProvider implements AndroidRuntimeProvider {
  readonly name = 'platinum' as const;
  private readonly client: Platinum;

  constructor(client?: Platinum) {
    this.client = client ?? new Platinum({
      url: config.PLATINUM_API_URL,
      token: config.PLATINUM_TOKEN!,
      timeoutMs: config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS,
    });
  }

  private async source(): Promise<Sandbox> {
    return this.client.sandboxes.connect(config.PLATINUM_ANDROID_SOURCE_SANDBOX_ID!);
  }

  private async sandbox(id: string): Promise<Sandbox> {
    return this.client.sandboxes.connect(id);
  }

  private async installControlAgent(
    sandbox: Sandbox,
    controlToken: string,
    vncPassword: string,
    proxyUrl: string | undefined,
  ): Promise<void> {
    const [source, launcher, extraServices, androidLauncher] = await Promise.all([
      readFile(resolve(process.cwd(), 'runtime/android-agent/server.mjs'), 'utf8'),
      readFile(resolve(process.cwd(), 'runtime/platinum/platinum-android-control'), 'utf8'),
      readFile(resolve(process.cwd(), 'runtime/platinum/platinum-extra-services'), 'utf8'),
      readFile(resolve(process.cwd(), 'runtime/platinum/platinum-android'), 'utf8'),
    ]);
    await checked(sandbox.exec([
      'install',
      '-d',
      '-m',
      '755',
      '/usr/local/lib/platinum-android-control',
      '/var/lib/android-control',
      '/var/lib/android-vnc',
      '/var/lib/android-network',
    ]));
    await sandbox.files.write(CONTROL_SOURCE_PATH, source);
    await sandbox.files.write(CONTROL_LAUNCHER_PATH, launcher);
    await sandbox.files.write(EXTRA_SERVICES_PATH, extraServices);
    // Golden snapshots keep their original launcher. Refresh it on every
    // provision/upgrade so renderer and boot hardening ship independently of
    // rebuilding the Android userdata image.
    await sandbox.files.write(ANDROID_LAUNCHER_PATH, androidLauncher);
    await sandbox.files.write(CONTROL_CONFIG_PATH, JSON.stringify({
      token: controlToken,
      port: config.PLATINUM_ANDROID_CONTROL_PORT,
      adb: '/opt/android-sdk/platform-tools/adb',
      whatsapp_package: 'com.whatsapp',
      appium_url: `http://127.0.0.1:${APPIUM_PORT}`,
    }));
    if (proxyUrl) {
      await sandbox.files.write(ANDROID_PROXY_PATH, `${proxyUrl}\n`);
    } else {
      await checked(sandbox.exec(['rm', '-f', ANDROID_PROXY_PATH]));
    }

    const password = shellSingleQuote(vncPassword);
    const bootstrap = `
set -eu
install -d -m 700 /var/lib/android-control /var/lib/android-vnc
chmod 755 ${CONTROL_SOURCE_PATH} ${CONTROL_LAUNCHER_PATH} ${EXTRA_SERVICES_PATH} ${ANDROID_LAUNCHER_PATH}
chmod 600 ${CONTROL_CONFIG_PATH}
if [ -f ${ANDROID_PROXY_PATH} ]; then chmod 600 ${ANDROID_PROXY_PATH}; fi
x11vnc -storepasswd ${password} /var/lib/android-vnc/passwd >/dev/null
chmod 600 /var/lib/android-vnc/passwd
if ! grep -Fq '# platinum-extra-services' /sbin/pt-app; then
  sed -i '/^exec \\/usr\\/local\\/bin\\/kortix-entrypoint/i # platinum-extra-services\\n${EXTRA_SERVICES_PATH}' /sbin/pt-app
fi
${EXTRA_SERVICES_PATH}
pkill -f '^/usr/bin/node ${CONTROL_SOURCE_PATH}$' || true
for i in $(seq 1 15); do
  if pgrep -f '^/usr/bin/node ${CONTROL_SOURCE_PATH}$' >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo 'Android control agent did not start' >&2
exit 1
`;
    const result = await sandbox.exec(['bash', '-lc', bootstrap], { timeoutMs: 30_000 });
    result.check();
  }

  private async restartAndroid(sandbox: Sandbox): Promise<void> {
    const prepare = `
set -eu
if pgrep -f '^/opt/android-sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 @whatsapp' >/dev/null; then
  if ! /usr/local/sbin/platinum-android-safe-poweroff; then
    # A freshly resumed snapshot can expose the qemu process before ADB has
    # moved from offline to device. In that narrow state Android cannot accept
    # a graceful poweroff, so terminate only qemu and let the durable launcher
    # start a clean emulator. Never fail provisioning on this boot race.
    pkill -TERM -f '^/opt/android-sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 @whatsapp' || true
  fi
  for i in $(seq 1 30); do
    if ! pgrep -f '^/opt/android-sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 @whatsapp' >/dev/null; then
      break
    fi
    sleep 1
  done
  if pgrep -f '^/opt/android-sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 @whatsapp' >/dev/null; then
    pkill -KILL -f '^/opt/android-sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 @whatsapp' || true
  fi
fi
/opt/android-sdk/platform-tools/adb kill-server >/dev/null 2>&1 || true
rm -f /run/platinum-android-hold-until
`;
    await checked(sandbox.exec(['bash', '-lc', prepare], { timeoutMs: 90_000 }));

    // api.platinum.dev is behind an HTTP request deadline shorter than a cold
    // Android boot. Keep each provider call short and poll client-side.
    const deadline = Date.now() + config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await sandbox.exec([
        'bash',
        '-lc',
        "/opt/android-sdk/platform-tools/adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r'",
      ], { timeoutMs: 15_000 });
      if (result.exit_code === 0 && result.stdout.trim() === '1') return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
    throw new Error('Android did not boot before the configured timeout');
  }

  private async callAgent(sandbox: Sandbox, action?: AndroidControlAction): Promise<unknown> {
    const method = action ? 'POST' : 'GET';
    const path = action ? '/v1/actions' : '/health';
    const payload = action ? Buffer.from(JSON.stringify(action)).toString('base64') : '';
    const command = action
      ? `printf %s ${shellSingleQuote(payload)} | base64 -d | curl --fail --silent --show-error --max-time 45 -X ${method} -H 'content-type: application/json' -H 'x-android-control-local: 1' --data-binary @- http://127.0.0.1:${config.PLATINUM_ANDROID_CONTROL_PORT}${path}`
      : `curl --fail --silent --show-error --max-time 15 -H 'x-android-control-local: 1' http://127.0.0.1:${config.PLATINUM_ANDROID_CONTROL_PORT}${path}`;
    const result = await sandbox.exec(['bash', '-lc', command], { timeoutMs: 60_000 });
    result.check();
    return JSON.parse(result.stdout);
  }

  private async waitForHealthyAndroid(sandbox: Sandbox): Promise<AndroidRuntimeHealth> {
    const deadline = Date.now() + config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS;
    let lastFailure = 'Android control agent did not report ready';

    while (Date.now() < deadline) {
      try {
        const health = await this.callAgent(sandbox) as Omit<AndroidRuntimeHealth, 'provider_state'>;
        if (
          health.android_booted
          && health.adb_state === 'device'
          && health.whatsapp_version
          && (!config.PLATINUM_ANDROID_APPIUM_REQUIRED || health.native_automation_ready)
        ) {
          return { provider_state: 'running', ...health };
        }
        lastFailure = JSON.stringify(health);
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }

    throw new Error(`Android did not become healthy: ${lastFailure}`);
  }

  async provision(input: ProvisionAndroidRuntimeInput): Promise<ProvisionedAndroidRuntime> {
    const source = await this.source();
    const clone = await source.clone({ snapshotId: config.PLATINUM_ANDROID_SNAPSHOT_ID! });
    const sandbox = await this.sandbox(clone.id);
    const controlToken = randomControlToken();
    const vncPassword = randomVncPassword();
    const proxyUrl = proxyFor(input);

    try {
      await sandbox.waitRunning({ timeoutMs: config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS });
      await sandbox.rename(input.name);
      await this.installControlAgent(
        sandbox,
        controlToken,
        vncPassword,
        proxyUrl,
      );
      await this.restartAndroid(sandbox);

      // Exposure updates currently share one sandbox metadata record. Keep these
      // sequential so concurrent read-modify-write requests cannot lose a port.
      const control = await sandbox.expose(config.PLATINUM_ANDROID_CONTROL_PORT, {
        public: false,
        ttlSeconds: 86_400,
      });
      const novnc = await sandbox.expose(config.PLATINUM_ANDROID_NOVNC_PORT, {
        public: config.PLATINUM_ANDROID_NOVNC_PUBLIC,
      });
      // sys.boot_completed can flip before PackageManager and ActivityManager are
      // ready. Wait for the complete control-plane health contract instead of
      // returning a transiently unhealthy runtime to the caller.
      const health = await this.waitForHealthyAndroid(sandbox);
      const state = await sandbox.refresh();

      return {
        provider: 'platinum',
        providerInstanceId: sandbox.id,
        sourceProviderInstanceId: config.PLATINUM_ANDROID_SOURCE_SANDBOX_ID!,
        snapshotId: config.PLATINUM_ANDROID_SNAPSHOT_ID!,
        state: health.android_booted ? 'running' : 'unknown',
        controlUrl: control.url,
        controlToken,
        novncUrl: new URL('/vnc.html?autoconnect=1&resize=scale', novnc.url).toString(),
        vncPassword,
        health,
        metadata: {
          cpu: state.cpu,
          ram_mb: state.ramMb,
          disk_gb: state.diskGb,
          control_port: config.PLATINUM_ANDROID_CONTROL_PORT,
          novnc_port: config.PLATINUM_ANDROID_NOVNC_PORT,
          novnc_public: config.PLATINUM_ANDROID_NOVNC_PUBLIC,
          proxy: publicProxyMetadata(proxyUrl),
          native_automation: 'appium-uiautomator2',
        },
      };
    } catch (error) {
      try {
        await sandbox.delete();
      } catch {
        // The original provisioning error is more actionable; deletion is best effort.
      }
      throw error;
    }
  }

  async inspect(providerInstanceId: string): Promise<AndroidRuntimeHealth> {
    const sandbox = await this.sandbox(providerInstanceId);
    const state = await sandbox.refresh();
    if (state.state !== 'running') {
      return { provider_state: providerState(state.state), android_booted: false };
    }
    try {
      const health = await this.callAgent(sandbox) as Omit<AndroidRuntimeHealth, 'provider_state'>;
      return { provider_state: providerState(state.state), ...health };
    } catch (error) {
      return {
        provider_state: providerState(state.state),
        android_booted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async upgrade(providerInstanceId: string, input: UpgradeAndroidRuntimeInput): Promise<AndroidRuntimeHealth> {
    const sandbox = await this.sandbox(providerInstanceId);
    const state = await sandbox.refresh();
    if (state.state !== 'running') throw new Error('Android runtime must be running before its control agent can be upgraded');
    await this.installControlAgent(sandbox, input.controlToken, input.vncPassword, input.proxyUrl);
    return this.waitForHealthyAndroid(sandbox);
  }

  async action(providerInstanceId: string, action: AndroidControlAction): Promise<unknown> {
    return this.callAgent(await this.sandbox(providerInstanceId), action);
  }

  async start(providerInstanceId: string): Promise<AndroidRuntimeHealth> {
    const sandbox = await this.sandbox(providerInstanceId);
    const state = await sandbox.refresh();
    if (state.state !== 'running') {
      await sandbox.start({
        waitForRunning: true,
        waitTimeoutMs: Math.min(config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS, 60_000),
      });
      await sandbox.waitRunning({ timeoutMs: config.PLATINUM_ANDROID_BOOT_TIMEOUT_MS });
    }
    await checked(sandbox.exec(['bash', '-lc', 'rm -f /run/platinum-android-hold-until; /usr/local/sbin/platinum-extra-services'], {
      timeoutMs: 15_000,
    }));
    await this.restartAndroid(sandbox);
    return this.inspect(providerInstanceId);
  }

  async stop(providerInstanceId: string): Promise<void> {
    const sandbox = await this.sandbox(providerInstanceId);
    const state = await sandbox.refresh();
    if (state.state !== 'running') return;
    await checked(sandbox.exec(['/usr/local/sbin/platinum-android-safe-poweroff'], {
      timeoutMs: 90_000,
    }));
    await sandbox.stop({ waitForStopped: true, waitTimeoutMs: 60_000 });
  }

  async destroy(providerInstanceId: string): Promise<void> {
    const sandbox = await this.sandbox(providerInstanceId);
    const state = await sandbox.refresh();
    if (state.state === 'running') {
      await checked(sandbox.exec(['/usr/local/sbin/platinum-android-safe-poweroff'], {
        timeoutMs: 90_000,
      }));
    }
    await sandbox.delete();
  }
}
