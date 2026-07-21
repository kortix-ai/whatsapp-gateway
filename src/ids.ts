import { randomUUID } from 'node:crypto';

export const id = (prefix: 'ten' | 'wa' | 'msg' | 'evt' | 'cmd' | 'whe' | 'whd' | 'aud') =>
  `${prefix}_${randomUUID().replaceAll('-', '')}`;
