import { BookOpen, ExternalLink, FileJson, ListTree, ScrollText, Sparkles } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const RESOURCES: { href: string; label: string; description: string; icon: ComponentType<{ className?: string }> }[] = [
  { href: '/docs', label: 'API reference', description: 'Interactive Scalar reference', icon: BookOpen },
  { href: '/openapi.json', label: 'OpenAPI 3.1', description: 'Machine-readable schema', icon: FileJson },
  { href: '/v1/skill.md', label: 'Agent skill', description: 'Credential-free SKILL.md', icon: Sparkles },
  { href: '/v1/capabilities.md', label: 'Capabilities', description: 'Compact route map', icon: ScrollText },
  { href: '/v1/baileys-actions', label: 'Baileys actions', description: 'Managed operation catalog', icon: ListTree },
];

function CodeSnippet({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg border bg-muted/40', className)}>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} variant="secondary" />
      </div>
      <pre className="overflow-x-auto p-4 pr-14 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function DeveloperPage() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://whatsapp.example.com';

  const cliSetup = `# Configure the wag CLI
export WHATSAPP_GATEWAY_URL=${origin}
export WHATSAPP_GATEWAY_API_KEY=wag_your_key_here

wag auth status
wag accounts list
wag messages send <account> --to +15551234567 --text "Hello from wag"`;

  const curlExample = `curl ${origin}/v1/accounts \\
  -H "Authorization: Bearer wag_your_key_here"

# Send a message through the durable command queue
curl -X POST ${origin}/v1/accounts/<account_id>/messages \\
  -H "X-API-Key: wag_your_key_here" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"to":"+15551234567","text":"Hello"}'`;

  const verifyExample = `import { createHmac, timingSafeEqual } from "node:crypto";

// input = timestamp + "." + raw_request_body
export function verify(rawBody, headers, secret) {
  const timestamp = headers["x-whatsapp-timestamp"];
  const signature = headers["x-whatsapp-signature"]; // "v1=<hex>"
  const expected = "v1=" + createHmac("sha256", secret)
    .update(timestamp + "." + rawBody)
    .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Developer" description="Everything an agent or engineer needs to build against this gateway." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RESOURCES.map(({ href, label, description, icon: Icon }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'group flex items-center gap-3 rounded-xl border bg-card p-4 transition-all',
              'hover:border-foreground/20 hover:shadow-sm',
              'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-sm font-medium">
                {label}
                <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            </div>
          </a>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Command-line (wag)" description="A thin client over the same REST API.">
          <CodeSnippet code={cliSetup} />
        </Section>
        <Section title="Authenticated requests" description="Send wag_ keys via Bearer or X-API-Key.">
          <CodeSnippet code={curlExample} />
        </Section>
      </div>

      <Section
        title="Verifying webhook signatures"
        description="Each delivery is signed with HMAC-SHA256 over timestamp + '.' + body."
      >
        <CodeSnippet code={verifyExample} />
      </Section>
    </div>
  );
}
