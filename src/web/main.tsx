import { FormEvent, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Account = {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  whatsappJid: string | null;
  status: string;
  lastError: string | null;
};

type Session = { user: { id: string; name: string; email: string } } | null;
type Message = { id: string; chatJid: string; direction: string; messageType: string; text: string | null; messageTimestamp: string };
type Group = { jid: string; subject: string };
type Delivery = { id: string; status: string; attemptCount: number; lastStatusCode: number | null; event: { type: string; accountId: string; occurredAt: string } };
type BaileysAction = { name: string; method: string; args: string; description: string; permission: { resource: string; action: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.message ?? `Request failed (${response.status})`);
  return payload as T;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/auth/${mode}/email`, {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') || 'Developer'),
          email: String(form.get('email')),
          password: String(form.get('password')),
        }),
      });
      onAuthenticated();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="mark">W</div>
      <p className="eyebrow">WhatsApp infrastructure</p>
      <h1>One API for every connected number.</h1>
      <p className="muted">Link an existing WhatsApp account, mint a scoped key, and let an agent work through a durable gateway.</p>
      <form onSubmit={submit}>
        {mode === 'sign-up' && <label>Name<input name="name" required autoComplete="name" /></label>}
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" minLength={10} required autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="link" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
        {mode === 'sign-in' ? 'Create a developer account' : 'Already have an account? Sign in'}
      </button>
    </section>
  </main>;
}

function Dashboard({ session, refreshSession }: { session: NonNullable<Session>; refreshSession: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [agentAccess, setAgentAccess] = useState<{ api_key: string; skill_md: string } | null>(null);
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string | null; start: string | null; enabled: boolean; createdAt: string }>>([]);
  const [webhooks, setWebhooks] = useState<Array<{ id: string; url: string; eventTypes: string[] }>>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [baileysActions, setBaileysActions] = useState<BaileysAction[]>([]);
  const [actionResult, setActionResult] = useState<unknown>(null);

  const load = useCallback(async () => {
    const [response, hooks, keys, deliveryResponse, actionResponse] = await Promise.all([
      request<{ data: Account[] }>('/v1/accounts'),
      request<{ data: Array<{ id: string; url: string; eventTypes: string[] }> }>('/v1/webhook-endpoints'),
      request<{ apiKeys: Array<{ id: string; name: string | null; start: string | null; enabled: boolean; createdAt: string }> }>('/api/auth/api-key/list'),
      request<{ data: Delivery[] }>('/v1/webhook-deliveries'),
      request<{ data: BaileysAction[] }>('/v1/baileys-actions'),
    ]);
    setAccounts(response.data);
    setSelected((current) => current ?? response.data[0]?.id ?? null);
    setWebhooks(hooks.data);
    setApiKeys(keys.apiKeys);
    setDeliveries(deliveryResponse.data);
    setBaileysActions(actionResponse.data);
  }, []);

  useEffect(() => { void load().catch((nextError) => setError(String(nextError))); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const update = () => request<Record<string, unknown>>(`/v1/accounts/${selected}/status`).then(setStatus).catch(() => undefined);
    void update();
    const timer = window.setInterval(update, 2_000);
    return () => window.clearInterval(timer);
  }, [selected]);
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      setGroups([]);
      return;
    }
    const update = () => Promise.all([
      request<{ data: Message[] }>(`/v1/accounts/${selected}/messages?limit=12`),
      request<{ data: Group[] }>(`/v1/accounts/${selected}/groups`),
    ]).then(([messageResponse, groupResponse]) => {
      setMessages(messageResponse.data);
      setGroups(groupResponse.data);
    }).catch(() => undefined);
    void update();
    const timer = window.setInterval(update, 3_000);
    return () => window.clearInterval(timer);
  }, [selected]);

  async function action(work: () => Promise<void>) {
    setError('');
    setNotice('');
    try { await work(); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await action(async () => {
      const account = await request<Account>('/v1/accounts', { method: 'POST', body: JSON.stringify({ display_name: form.get('display_name'), phone_number: form.get('phone_number') || undefined }) });
      await load();
      setSelected(account.id);
      setNotice('Connection created. Pair it from the account panel.');
      formElement.reset();
    });
  }

  async function pairQr() {
    if (!selected) return;
    await action(async () => {
      const response = await request<Record<string, unknown>>(`/v1/accounts/${selected}/pair/qr`, { method: 'POST', body: '{}' });
      setStatus(response);
      setNotice('Open WhatsApp → Linked devices → Link a device, then scan this QR.');
    });
  }

  async function pairCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await action(async () => {
      const response = await request<{ code?: string }>(`/v1/accounts/${selected}/pair/code`, { method: 'POST', body: JSON.stringify({ phone_number: form.get('phone_number') }) });
      setNotice(response.code ? `Enter pairing code ${response.code} in WhatsApp.` : 'Pairing code request queued.');
    });
  }

  async function mintAgentAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action(async () => {
      const response = await request<{ api_key: string; skill_md: string }>('/v1/agent-access', {
        method: 'POST', body: JSON.stringify({ name: form.get('name'), account_ids: selected ? [selected] : undefined }),
      });
      setAgentAccess(response);
      setNotice('Agent key created. It is shown once.');
      await load();
    });
  }

  async function revokeKey(keyId: string) {
    await action(async () => {
      await request('/api/auth/api-key/delete', { method: 'POST', body: JSON.stringify({ keyId }) });
      setAgentAccess(null);
      setNotice('API key revoked.');
      await load();
    });
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await action(async () => {
      const response = await request<{ secret: string }>('/v1/webhook-endpoints', {
        method: 'POST', body: JSON.stringify({ url: form.get('url'), event_types: [] }),
      });
      setNotice(`Webhook created. Copy its one-time signing secret now: ${response.secret}`);
      await load();
      formElement.reset();
    });
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await action(async () => {
      const result = await request<Record<string, unknown>>(`/v1/accounts/${selected}/messages`, {
        method: 'POST',
        body: JSON.stringify({ to: form.get('to'), text: form.get('text') }),
      });
      setNotice(`Message accepted: ${JSON.stringify(result)}`);
      formElement.reset();
    });
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const participants = String(form.get('participants')).split(',').map((value) => value.trim()).filter(Boolean);
    await action(async () => {
      const result = await request<Record<string, unknown>>(`/v1/accounts/${selected}/groups`, {
        method: 'POST',
        body: JSON.stringify({ subject: form.get('subject'), participants }),
      });
      setNotice(`Group accepted: ${JSON.stringify(result)}`);
      formElement.reset();
    });
  }

  async function executeBaileysAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await action(async () => {
      const actionName = String(form.get('action'));
      const args = JSON.parse(String(form.get('args') || '[]')) as unknown[];
      if (!Array.isArray(args)) throw new Error('Action arguments must be a JSON array');
      const result = await request<unknown>(`/v1/accounts/${selected}/actions/${encodeURIComponent(actionName)}`, {
        method: 'POST', body: JSON.stringify({ args }),
      });
      setActionResult(result);
      setNotice(`${actionName} completed or was durably queued.`);
    });
  }

  const selectedAccount = accounts.find((account) => account.id === selected);
  const qr = typeof status?.qr_data_url === 'string' ? status.qr_data_url : null;

  return <div className="app-shell">
    <header>
      <div className="brand"><span className="mark small">W</span><span>WhatsApp Gateway</span></div>
      <nav><a href="/docs" target="_blank">API reference</a><a href="/v1/skill.md">Agent skill</a><button className="link" onClick={() => request('/api/auth/sign-out', { method: 'POST', body: '{}' }).then(refreshSession)}>Sign out</button></nav>
    </header>
    <div className="layout">
      <aside>
        <div className="aside-title"><span>Numbers</span><span>{accounts.length}</span></div>
        <div className="account-list">
          {accounts.map((account) => <button key={account.id} className={selected === account.id ? 'account active' : 'account'} onClick={() => setSelected(account.id)}>
            <span>{account.displayName}</span><small>{account.phoneNumber ? `+${account.phoneNumber}` : 'Not paired'}</small><i className={`dot ${account.status}`} />
          </button>)}
          {!accounts.length && <p className="empty">No connected numbers yet.</p>}
        </div>
        <form className="compact-form" onSubmit={createAccount}>
          <input name="display_name" placeholder="Connection name" required />
          <input name="phone_number" placeholder="Phone (optional)" />
          <button>Add number</button>
        </form>
      </aside>
      <main className="workspace">
        <div className="welcome"><div><p className="eyebrow">Developer console</p><h1>{selectedAccount?.displayName ?? `Welcome, ${session.user.name}`}</h1><p className="muted">{selectedAccount ? selectedAccount.id : 'Create your first number connection to begin.'}</p></div><span className={`status-pill ${String(status?.status ?? 'disconnected')}`}>{String(status?.status ?? 'disconnected')}</span></div>
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error-box">{error}</div>}
        <div className="grid">
          <section className="panel pairing">
            <div className="panel-head"><div><p className="eyebrow">Linked device</p><h2>Pair this number</h2></div></div>
            {qr ? <div className="qr-wrap"><img src={qr} alt="WhatsApp linked-device QR code" /><p>Scan from WhatsApp → Linked devices</p></div> : <div className="placeholder"><span>QR</span><p>Start QR pairing to securely link an existing WhatsApp account.</p></div>}
            <button className="primary" disabled={!selected} onClick={pairQr}>Generate QR code</button>
            <div className="divider"><span>or use a phone number</span></div>
            <form className="inline-form" onSubmit={pairCode}><input name="phone_number" placeholder="+1 555 123 4567" required /><button disabled={!selected}>Get pairing code</button></form>
          </section>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">Agent access</p><h2>Mint a scoped key</h2></div></div>
            <p className="muted">The generated skill carries a key restricted to the selected WhatsApp number. The key is stored hashed and shown once.</p>
            <form className="stack-form" onSubmit={mintAgentAccess}><input name="name" defaultValue="My WhatsApp agent" required /><button className="primary" disabled={!selected}>Create key + SKILL.md</button></form>
            {agentAccess && <div className="secret-box"><code>{agentAccess.api_key}</code><div><button onClick={() => navigator.clipboard.writeText(agentAccess.api_key)}>Copy key</button><button onClick={() => { const url = URL.createObjectURL(new Blob([agentAccess.skill_md], { type: 'text/markdown' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SKILL.md'; anchor.click(); URL.revokeObjectURL(url); }}>Download skill</button></div></div>}
            <div className="key-list">{apiKeys.map((key) => <div className="key-row" key={key.id}><div><strong>{key.name ?? 'Unnamed key'}</strong><code>{key.start ?? 'wag_…'}</code></div><button onClick={() => revokeKey(key.id)}>Revoke</button></div>)}</div>
          </section>
          <section className="panel wide">
            <div className="panel-head"><div><p className="eyebrow">Event delivery</p><h2>Webhooks</h2></div><span>{webhooks.length} endpoints</span></div>
            <form className="inline-form" onSubmit={createWebhook}><input name="url" type="url" placeholder="https://agent.example.com/webhooks/whatsapp" required /><button>Create endpoint</button></form>
            <div className="rows">{webhooks.map((hook) => <div className="row" key={hook.id}><span>{hook.url}</span><code>{hook.id}</code></div>)}{!webhooks.length && <p className="empty">All message, connection, group, contact, chat, and call events can be signed and delivered here.</p>}</div>
            <div className="delivery-strip">{deliveries.slice(0, 8).map((delivery) => <div className="delivery" key={delivery.id}><span className={`delivery-state ${delivery.status}`}>{delivery.status}</span><strong>{delivery.event.type}</strong><small>{delivery.lastStatusCode ?? `attempt ${delivery.attemptCount}`}</small></div>)}</div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">Live API</p><h2>Send a message</h2></div></div>
            <p className="muted">Use an E.164 phone number or a WhatsApp JID. Delivery runs through the same durable command queue agents use.</p>
            <form className="stack-form" onSubmit={sendMessage}><input name="to" placeholder="+1 555 123 4567" required /><textarea name="text" placeholder="Message" required /><button className="primary" disabled={status?.status !== 'connected'}>Send message</button></form>
          </section>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">Live API</p><h2>Create a group</h2></div><span>{groups.length} synced</span></div>
            <p className="muted">Enter one or more participant phone numbers separated by commas.</p>
            <form className="stack-form" onSubmit={createGroup}><input name="subject" placeholder="Group name" required /><input name="participants" placeholder="+15551234567, +15557654321" required /><button className="primary" disabled={status?.status !== 'connected'}>Create group</button></form>
          </section>
          <section className="panel wide">
            <div className="panel-head"><div><p className="eyebrow">Complete passthrough</p><h2>Baileys action explorer</h2></div><span>{baileysActions.length} managed actions</span></div>
            <form className="action-form" onSubmit={executeBaileysAction}>
              <select name="action" required>{baileysActions.map((entry) => <option value={entry.name} key={entry.name}>{entry.name} · {entry.method} · {entry.args}</option>)}</select>
              <textarea name="args" defaultValue="[]" spellCheck={false} aria-label="JSON arguments" />
              <button className="primary" disabled={status?.status !== 'connected'}>Execute action</button>
            </form>
            {actionResult !== null && <pre className="result">{JSON.stringify(actionResult, null, 2)}</pre>}
          </section>
          <section className="panel wide">
            <div className="panel-head"><div><p className="eyebrow">Durable synchronization</p><h2>Recent messages</h2></div><span>refreshes every 3 seconds</span></div>
            <div className="message-list">{messages.map((message) => <div className="message-row" key={message.id}><span className={`direction ${message.direction}`}>{message.direction}</span><div><strong>{message.text ?? `[${message.messageType}]`}</strong><small>{message.chatJid} · {new Date(message.messageTimestamp).toLocaleString()}</small></div></div>)}{!messages.length && <p className="empty">Incoming and outgoing messages will appear here after the number is connected.</p>}</div>
          </section>
        </div>
      </main>
    </div>
  </div>;
}

function App() {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const refresh = useCallback(() => request<Session>('/api/auth/get-session').then(setSession).catch(() => setSession(null)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (session === undefined) return <div className="loading">Loading gateway…</div>;
  return session ? <Dashboard session={session} refreshSession={refresh} /> : <AuthScreen onAuthenticated={refresh} />;
}

createRoot(document.getElementById('root')!).render(<App />);
