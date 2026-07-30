# Native Android runtimes on Platinum

The gateway supports a second WhatsApp transport boundary alongside Baileys:
one persistent native Android installation per Platinum sandbox. It does not
use WhatsApp Web and it does not reimplement the WhatsApp protocol.

## What the runtime is

```text
Platinum sandbox
└── Ubuntu 24.04 Linux microVM
    ├── nested KVM
    ├── Xvfb + x11vnc + noVNC
    ├── authenticated Android control service
    ├── Appium 3 + UiAutomator2 native automation
    └── official Google Android Emulator
        └── Android 14 Google Play x86_64 AVD
            └── native com.whatsapp Android app
```

This is not a Docker Android image, Waydroid, redroid, or Android-x86. The
reusable artifact is a Platinum snapshot of the Linux microVM disk. Android
itself is another KVM-accelerated VM launched by the official Android Emulator.

The checked-in image contract is
[`runtime/platinum/android-image.json`](../runtime/platinum/android-image.json).
It records the source sandbox, validated snapshot, resource shape, ports, and
pre-enrollment invariant.

For the API decision—official Business App coexistence, Android plus a linked
companion, and the limits of direct app control—read
[`ANDROID_API_ARCHITECTURE.md`](./ANDROID_API_ARCHITECTURE.md).

## Why a snapshot instead of a catalog template

Platinum supports this lifecycle through `@platinum-dev/sdk`:

1. Connect to the retained source sandbox.
2. Clone its validated snapshot.
3. Wait for the child sandbox to reach `running`.
4. Update the baked bounded Android control service and rotate its token.
5. Generate unique control and VNC credentials.
6. Inject the instance's stable HTTP(S) residential proxy, if configured.
7. Gracefully restart Android so the emulator and x11vnc load the new settings.
8. Verify Appium, UiAutomator2, WhatsApp, ADB, and the notification listener.
9. Expose noVNC and a short-lived private control URL.
10. Persist the provider identity and encrypted credentials in PostgreSQL.

The current organization token can clone snapshots but cannot promote one into
a named catalog template. Snapshot-based provisioning is therefore the
supported factory path today.

## Configuration

```dotenv
ANDROID_RUNTIME_PROVIDER=platinum
PLATINUM_API_URL=https://api.platinum.dev
PLATINUM_TOKEN=pt_live_...
PLATINUM_ANDROID_SOURCE_SANDBOX_ID=sbx_01KYK6HNFFXRJR0ZGWZY6XR26C
PLATINUM_ANDROID_SNAPSHOT_ID=snap_01KYK7J4HP78S1T208KNQR395N
PLATINUM_ANDROID_CONTROL_PORT=8787
PLATINUM_ANDROID_NOVNC_PORT=6080
PLATINUM_ANDROID_NOVNC_PUBLIC=true
PLATINUM_ANDROID_BOOT_TIMEOUT_MS=240000
PLATINUM_ANDROID_PROXY_URL=http://user:password@geo.iproyal.com:12321
PLATINUM_ANDROID_APPIUM_REQUIRED=true
```

`PLATINUM_TOKEN` is server-only. Per-instance control URLs, control tokens, and
VNC passwords are encrypted with the gateway `ENCRYPTION_KEY`. Creation returns
the plaintext credentials once; list/get responses never return them.

`PLATINUM_ANDROID_PROXY_URL` must be one stable HTTP(S) CONNECT proxy. When it
is empty, an HTTP(S) `WA_PROXY_URL` is reused. SOCKS URLs are not passed to the
official emulator because its `-http-proxy` flag does not support them. Proxy
credentials are written only to the per-instance guest with mode `0600`; the
golden snapshot contains no residential proxy credential. Do not rotate an
enrolled account across exit IPs.

## API

Provisioning is synchronous and may take several minutes. Use an idempotency key
and a client timeout of at least five minutes:

```http
POST /v1/android/instances
X-API-Key: wag_...
Idempotency-Key: customer-number-42
Content-Type: application/json

{"display_name":"Customer 42","account_id":"wa_existing_companion_account"}
```

An optional per-instance `proxy_url` overrides the server default. It is
write-only and encrypted at rest.

`account_id` binds one Android primary device to one existing gateway account.
That enables the recommended personal-account hybrid: the cloud Android holds
the durable primary identity while the existing Baileys account remains the
linked companion behind the full normalized REST API.

The `201` response contains one-time `credentials` with:

- a noVNC URL;
- the unique eight-character VNC password;
- a short-lived private control URL;
- the independent in-guest bearer token.

Other lifecycle routes:

```text
GET    /v1/android/instances
GET    /v1/android/instances/{instanceId}
GET    /v1/android/instances/{instanceId}/status
POST   /v1/android/instances/{instanceId}/start
POST   /v1/android/instances/{instanceId}/upgrade
POST   /v1/android/instances/{instanceId}/stop
DELETE /v1/android/instances/{instanceId}
```

Bounded native control:

```http
POST /v1/android/instances/{instanceId}/actions
Content-Type: application/json

{"type":"whatsapp.launch"}
```

Supported actions are:

- `whatsapp.launch`
- `whatsapp.compose`
- `whatsapp.open_chat`
- `whatsapp.send_text`
- `whatsapp.force_stop`
- `apps.list`
- `app.open`
- `url.open`
- `notifications.list`
- `notifications.open_shade`
- `network.egress`
- `screen.screenshot`
- `ui.dump`
- `ui.source`
- `ui.find`
- `ui.find_all`
- `ui.click`
- `ui.set_value`
- `input.tap`
- `input.long_press`
- `input.swipe`
- `input.text`
- `input.keyevent`
- `clipboard.set`
- `clipboard.paste`
- `share.text`

There is deliberately no arbitrary shell action. The gateway calls the
in-guest service locally through a Platinum exec operation, while the optional
external control URL requires both the private Platinum preview token and the
independent bearer token.

`whatsapp.compose` and `whatsapp.open_chat` open a native `wa.me` intent.
`whatsapp.send_text` explicitly finds and clicks the real WhatsApp send button
through UiAutomator2. `notifications.list` returns only WhatsApp entries from
Appium Settings' 100-event active/recent notification buffer. Generic selector
actions accept `accessibility id`, `id`, `-android uiautomator`, or `xpath`.

`POST /upgrade` replaces the authenticated controller scripts and the
next-boot Android launcher inside a running sandbox, keeps the existing
control/VNC credentials and proxy, restarts the controller supervisor, and
verifies its reported `agent_version`. It does not restart Android or
copy/alter WhatsApp userdata. Use it to roll new bounded actions and boot
hardening across an enrolled fleet without cloning phone identities.

This is the native controller boundary, but it is not a private WhatsApp API.
WhatsApp UI/resource changes can require selector updates, notifications are
not a complete chat database, and Android still cannot expose encryption keys
or internal WhatsApp storage without rooting/instrumenting the app. The
gateway deliberately avoids those unsafe techniques.

## Golden-image safety

- Keep the golden snapshot pre-enrollment.
- Never clone an enrolled WhatsApp userdata identity.
- Assign one phone number and one persistent sandbox to each native account.
- Rotate credentials for every clone.
- Power Android off through
  `/usr/local/sbin/platinum-android-safe-poweroff` before stopping, deleting,
  or taking a reusable snapshot.
- Do not root or instrument WhatsApp. That weakens security and increases
  compatibility and account-risk.

## Verification

Run local tests first, then the disposable live smoke:

```bash
pnpm test
pnpm typecheck

PLATINUM_TOKEN=pt_live_... \
pnpm e2e:platinum-android
```

The live smoke clones the configured snapshot, rotates the control service,
boots Android, verifies WhatsApp and Appium health, reads the live native UI
tree, queries the notification bridge, validates residential proxy attachment
when requested, loads noVNC assets externally, calls the external authenticated
control endpoint, captures a native Android screenshot, gracefully powers
Android off, and deletes the disposable sandbox.

Set `E2E_KEEP_ANDROID_INSTANCE=1` only when intentionally retaining the child
for debugging.

## Scaling boundary

Each clone currently reserves approximately 4 vCPU, 8 GiB sandbox RAM, and
30 GB disk. A fleet controller should enforce capacity and per-tenant quotas.
Consumer WhatsApp accounts may still treat datacenter IPs, mass enrollment, or
automation-like behavior as risky. For high-volume commercial messaging, the
official WhatsApp Business Platform remains the supported path.
