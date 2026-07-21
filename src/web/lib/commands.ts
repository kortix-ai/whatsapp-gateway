import { toast } from 'sonner';
import type { CommandEnvelope } from './types';

/**
 * Surface the outcome of a durable command consistently. Completed → success,
 * failed → error with the server reason, pending/processing → the command is
 * queued and identified so the operator can follow it up.
 */
export function notifyCommand(envelope: CommandEnvelope, messages: { success: string; pending?: string }) {
  if (envelope.status === 'completed') {
    toast.success(messages.success);
    return;
  }
  if (envelope.status === 'failed') {
    toast.error('Command failed', { description: envelope.error ?? 'The gateway rejected this command.' });
    return;
  }
  toast.info(messages.pending ?? 'Command queued', {
    description: `Tracking ${envelope.command_id}. It will complete once the worker processes it.`,
  });
}
