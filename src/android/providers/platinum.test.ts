import type { Platinum } from '@platinum-dev/sdk';
import { describe, expect, it, vi } from 'vitest';
import { PlatinumAndroidRuntimeProvider } from './platinum.js';

function execResult(stdout = '') {
  return {
    stdout,
    stderr: '',
    exit_code: 0,
    check() {
      return this;
    },
  };
}

describe('PlatinumAndroidRuntimeProvider', () => {
  it('clones the golden snapshot, rotates credentials, installs the agent, and exposes both surfaces', async () => {
    const source = {
      clone: vi.fn().mockResolvedValue({
        id: 'sbx_child',
        cloned_from: 'sbx_source',
        snapshot_id: 'snap_test',
        state: 'resuming',
      }),
    };
    const child = {
      id: 'sbx_child',
      files: { write: vi.fn().mockResolvedValue(undefined) },
      waitRunning: vi.fn().mockResolvedValue({ state: 'running' }),
      rename: vi.fn().mockResolvedValue({ state: 'running' }),
      exec: vi.fn().mockImplementation(async (argv: string[]) => {
        const command = Array.isArray(argv) ? argv.join(' ') : String(argv);
        if (command.includes('curl') && command.includes('/health')) {
          return execResult(JSON.stringify({
            agent_version: '2026-07-28.1',
            android_booted: true,
            adb_state: 'device',
            android_version: '14',
            whatsapp_version: '2.26.29.74',
            foreground_activity: 'com.whatsapp/.registration.app.EULA',
            native_automation_ready: true,
          }));
        }
        if (command.includes('getprop sys.boot_completed')) {
          return execResult('1\n');
        }
        return execResult();
      }),
      expose: vi.fn().mockImplementation(async (port: number, options: { public: boolean }) => ({
        port,
        sandbox_id: 'sbx_child',
        public: options.public,
        url: port === 6080
          ? 'https://6080-child.sbx.platinum.dev/'
          : 'https://8787-child.sbx.platinum.dev/?t=private',
      })),
      refresh: vi.fn().mockResolvedValue({
        state: 'running',
        cpu: 4,
        ramMb: 8192,
        diskGb: 30,
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      sandboxes: {
        connect: vi.fn().mockImplementation(async (id: string) => id === 'sbx_child' ? child : source),
      },
    } as unknown as Platinum;

    const provider = new PlatinumAndroidRuntimeProvider(client);
    const result = await provider.provision({ name: 'wa-android-test' });

    expect(source.clone).toHaveBeenCalledWith({ snapshotId: expect.stringMatching(/^snap_/) });
    expect(child.rename).toHaveBeenCalledWith('wa-android-test');
    expect(child.files.write).toHaveBeenCalledWith(
      '/usr/local/lib/platinum-android-control/server.mjs',
      expect.stringContaining('android_control_listening'),
    );
    expect(child.files.write).toHaveBeenCalledWith(
      '/usr/local/sbin/platinum-android',
      expect.stringContaining('-gpu software'),
    );
    expect(child.expose).toHaveBeenCalledWith(6080, { public: true });
    expect(child.expose).toHaveBeenCalledWith(8787, { public: false, ttlSeconds: 86_400 });
    expect(result.providerInstanceId).toBe('sbx_child');
    expect(result.vncPassword).toHaveLength(8);
    expect(result.controlToken.length).toBeGreaterThan(32);
    expect(result.novncUrl).toContain('/vnc.html?autoconnect=1&resize=scale');
    expect(result.health).toMatchObject({
      agent_version: '2026-07-28.1',
      android_booted: true,
      whatsapp_version: '2.26.29.74',
      native_automation_ready: true,
    });

    child.files.write.mockClear();
    const upgraded = await provider.upgrade('sbx_child', {
      controlToken: result.controlToken,
      vncPassword: result.vncPassword,
      proxyUrl: 'http://proxy.example:8080',
    });
    expect(child.files.write).toHaveBeenCalledWith(
      '/usr/local/lib/platinum-android-control/server.mjs',
      expect.stringContaining("const agentVersion = '2026-07-28.1'"),
    );
    expect(child.files.write).toHaveBeenCalledWith(
      '/var/lib/android-control/config.json',
      expect.stringContaining(result.controlToken),
    );
    expect(child.files.write).toHaveBeenCalledWith(
      '/usr/local/sbin/platinum-android',
      expect.stringContaining('-no-metrics'),
    );
    expect(upgraded.agent_version).toBe('2026-07-28.1');
  });
});
