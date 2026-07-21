import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/lib/auth';
import { SignInPage, SignUpPage } from '@/features/auth/auth-screen';
import { NumbersListPage } from '@/features/numbers/numbers-list-page';
import { NewNumberPage } from '@/features/numbers/new-number-page';
import { NumberLayout } from '@/features/numbers/number-layout';
import { OverviewPage } from '@/features/numbers/overview-page';
import { PairingPage } from '@/features/pairing/pairing-page';
import { ChatsPage } from '@/features/chats/chats-page';
import { ContactsPage } from '@/features/contacts/contacts-page';
import { GroupsPage } from '@/features/groups/groups-page';
import { MessagesPage } from '@/features/messages/messages-page';
import { ActionsPage } from '@/features/baileys-actions/actions-page';
import { WebhooksListPage } from '@/features/webhooks/webhooks-list-page';
import { NewWebhookPage } from '@/features/webhooks/new-webhook-page';
import { WebhookLayout } from '@/features/webhooks/webhook-layout';
import { WebhookOverviewPage } from '@/features/webhooks/webhook-overview-page';
import { WebhookDeliveriesPage } from '@/features/webhooks/webhook-deliveries-page';
import { ApiKeysPage } from '@/features/api-keys/api-keys-page';
import { DeveloperPage } from '@/features/developer/developer-page';
import { NotFoundPage } from '@/features/not-found';

function FullScreenLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

/** Gate the authenticated app: wait for the session, then redirect or render. */
function AppGate() {
  const session = useSession();
  const location = useLocation();
  if (session.isLoading) return <FullScreenLoader />;
  if (!session.data?.user) return <Navigate to="/auth/sign-in" replace state={{ from: location }} />;
  return <AppLayout user={session.data.user} />;
}

/** Keep signed-in operators out of the auth screens. */
function GuestOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isLoading) return <FullScreenLoader />;
  if (session.data?.user) return <Navigate to="/app/numbers" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/numbers" replace />} />
      <Route path="/auth/sign-in" element={<GuestOnly><SignInPage /></GuestOnly>} />
      <Route path="/auth/sign-up" element={<GuestOnly><SignUpPage /></GuestOnly>} />

      <Route path="/app" element={<AppGate />}>
        <Route index element={<Navigate to="numbers" replace />} />
        <Route path="numbers" element={<NumbersListPage />} />
        <Route path="numbers/new" element={<NewNumberPage />} />
        <Route path="numbers/:accountId" element={<NumberLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="pairing" element={<PairingPage />} />
          <Route path="chats" element={<ChatsPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="actions" element={<ActionsPage />} />
        </Route>
        <Route path="webhooks" element={<WebhooksListPage />} />
        <Route path="webhooks/new" element={<NewWebhookPage />} />
        <Route path="webhooks/:endpointId" element={<WebhookLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<WebhookOverviewPage />} />
          <Route path="deliveries" element={<WebhookDeliveriesPage />} />
        </Route>
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="developer" element={<DeveloperPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
