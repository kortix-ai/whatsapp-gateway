import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useCreateAccount } from './api';

const schema = z.object({
  display_name: z.string().min(1, 'Give this connection a name').max(80),
  phone_number: z.string().max(32).optional(),
});

export function NewNumberPage() {
  const navigate = useNavigate();
  const createAccount = useCreateAccount();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: '', phone_number: '' },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    createAccount.mutate(
      { display_name: values.display_name, ...(values.phone_number ? { phone_number: values.phone_number } : {}) },
      {
        onSuccess: (account) => {
          toast.success('Connection created', { description: 'Pair it now to link your WhatsApp account.' });
          navigate(`/app/numbers/${account.id}/pairing`);
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link to="/app/numbers">
          <ArrowLeft /> Numbers
        </Link>
      </Button>

      <PageHeader
        title="New connection"
        description="Name a connection now; you can pair the WhatsApp account in the next step."
      />

      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-5">
              {createAccount.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {createAccount.error instanceof ApiError ? createAccount.error.message : 'Unable to create the connection.'}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Connection name</FormLabel>
                    <FormControl>
                      <Input placeholder="Support line" autoFocus {...field} />
                    </FormControl>
                    <FormDescription>A label to recognise this number in the console and logs.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Phone number <span className="font-normal text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+1 555 123 4567" inputMode="tel" {...field} />
                    </FormControl>
                    <FormDescription>Pre-fills phone-code pairing. You can also add it later.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t">
              <Button type="button" variant="ghost" asChild>
                <Link to="/app/numbers">Cancel</Link>
              </Button>
              <Button type="submit" loading={createAccount.isPending}>
                Create connection
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
