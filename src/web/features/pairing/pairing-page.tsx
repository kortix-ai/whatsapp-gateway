import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, KeyRound, QrCode, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { formatCountdown, formatPhone } from '@/lib/format';
import { useCountdown } from '@/lib/hooks';
import { useAccountStatus, usePairCode, usePairQr } from '@/features/numbers/api';
import { useNumberContext } from '@/features/numbers/number-context';

const STEPS = [
  'Open WhatsApp on the phone that owns this number.',
  'Go to Settings → Linked Devices → Link a Device.',
  'Scan the QR code, or choose "Link with phone number instead".',
  'Keep this page open until the status turns Connected.',
];

export function PairingPage() {
  const { account } = useNumberContext();
  const { data: status } = useAccountStatus(account.id);
  const pairQr = usePairQr(account.id);

  const live = status?.status ?? account.status;
  const connected = live === 'connected';

  if (connected) return <ConnectedState phone={status?.phone_number ?? account.phoneNumber} jid={status?.whatsapp_jid ?? account.whatsappJid} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Link this number</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="qr">
            <TabsList className="w-full">
              <TabsTrigger value="qr" className="flex-1">
                <QrCode /> QR code
              </TabsTrigger>
              <TabsTrigger value="code" className="flex-1">
                <KeyRound /> Phone code
              </TabsTrigger>
            </TabsList>
            <TabsContent value="qr" className="mt-5">
              <QrPanel status={status} pairQr={pairQr} />
            </TabsContent>
            <TabsContent value="code" className="mt-5">
              <CodePanel accountId={account.id} defaultPhone={account.phoneNumber} status={status} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">How pairing works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {STEPS.map((step, index) => (
                <li key={index} className="flex gap-3 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        {status?.last_error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Last pairing error</AlertTitle>
            <AlertDescription>{status.last_error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

function QrPanel({
  status,
  pairQr,
}: {
  status: ReturnType<typeof useAccountStatus>['data'];
  pairQr: ReturnType<typeof usePairQr>;
}) {
  const qr = status?.qr_data_url ?? (typeof pairQr.data?.qr_data_url === 'string' ? pairQr.data.qr_data_url : null);
  const remaining = useCountdown(status?.pairing_mode === 'qr' ? status?.pairing_expires_at : null);
  const expired = remaining !== null && remaining <= 0;
  const showQr = qr && !expired;
  const generating = !expired && (
    pairQr.isPending
    || (status?.pairing_mode === 'qr' && !qr && (status.status === 'connecting' || status.status === 'pairing'))
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-xl border bg-white p-3">
        {showQr ? (
          <img src={qr} alt="WhatsApp linking QR code" className="size-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            {generating ? (
              <>
                <Spinner className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Generating a secure QR code…</p>
              </>
            ) : expired ? (
              <>
                <TriangleAlert className="size-6 text-warning-foreground dark:text-warning" />
                <p className="text-sm text-muted-foreground">This QR code expired. Generate a fresh one.</p>
              </>
            ) : (
              <>
                <QrCode className="size-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Generate a QR code to link the device.</p>
              </>
            )}
          </div>
        )}
      </div>

      {showQr && remaining !== null && (
        <p className="text-sm text-muted-foreground">
          Expires in <span className="font-mono font-medium text-foreground">{formatCountdown(remaining)}</span>
        </p>
      )}

      {pairQr.isError && (
        <Alert variant="destructive">
          <AlertDescription>{pairQr.error instanceof ApiError ? pairQr.error.message : 'Could not start pairing.'}</AlertDescription>
        </Alert>
      )}

      <Button
        className="w-full"
        variant={showQr ? 'outline' : 'default'}
        loading={generating}
        onClick={() => pairQr.mutate()}
      >
        <RefreshCw /> {showQr ? 'Regenerate QR code' : 'Generate QR code'}
      </Button>
    </div>
  );
}

const codeSchema = z.object({ phone_number: z.string().min(7, 'Enter the number in international format').max(32) });

function CodePanel({
  accountId,
  defaultPhone,
  status,
}: {
  accountId: string;
  defaultPhone: string | null;
  status: ReturnType<typeof useAccountStatus>['data'];
}) {
  const pairCode = usePairCode(accountId);
  const form = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { phone_number: defaultPhone ? formatPhone(defaultPhone) : '' },
  });

  const code = status?.pairing_mode === 'code' ? status?.pairing_code : null;
  const requesting = pairCode.isPending || (status?.pairing_mode === 'code' && !code && status?.status === 'connecting');

  function onSubmit(values: z.infer<typeof codeSchema>) {
    pairCode.mutate(values, {
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not request a code.'),
    });
  }

  if (code) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">Enter this code in WhatsApp on your phone:</p>
        <div className="flex items-center justify-center gap-2">
          <div className="flex gap-1.5">
            {code.split('').map((char, index) => (
              <span
                key={index}
                className="flex size-11 items-center justify-center rounded-md border bg-muted font-mono text-xl font-semibold"
              >
                {char}
              </span>
            ))}
          </div>
          <CopyButton value={code} variant="ghost" />
        </div>
        <p className="text-xs text-muted-foreground">Waiting for you to confirm on the device…</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="phone_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone number</FormLabel>
              <FormControl>
                <Input placeholder="+1 555 123 4567" inputMode="tel" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" loading={requesting}>
          {requesting ? 'Requesting code…' : 'Get pairing code'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          WhatsApp shows an eight-character code to type on the phone that owns this number.
        </p>
      </form>
    </Form>
  );
}

function ConnectedState({ phone, jid }: { phone: string | null; jid: string | null }) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/12 text-success">
          <CheckCircle2 className="size-8" />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">This number is connected</h2>
          <p className="text-sm text-muted-foreground">The linked device is online and ready to send and receive.</p>
        </div>
        <dl className="w-full max-w-xs space-y-1 rounded-lg border bg-muted/40 p-3 text-left text-sm">
          {phone && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-medium">{formatPhone(phone)}</dd>
            </div>
          )}
          {jid && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">JID</dt>
              <dd className="truncate font-mono text-xs">{jid}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link to="../overview" relative="path">
              <Smartphone /> Overview
            </Link>
          </Button>
          <Button asChild>
            <Link to="/app/api-keys">
              <KeyRound /> Create API key
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
