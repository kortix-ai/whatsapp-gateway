import { useOutletContext } from 'react-router-dom';
import type { Account } from '@/lib/types';

export type NumberContext = { account: Account };

export function useNumberContext() {
  return useOutletContext<NumberContext>();
}
