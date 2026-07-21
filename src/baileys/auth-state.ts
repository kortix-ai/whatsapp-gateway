import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys';
import { decryptJson, encryptJson } from '../crypto.js';
import { prisma } from '../db/prisma.js';

function encode(value: unknown): string {
  return encryptJson(JSON.stringify(value, BufferJSON.replacer));
}

function decode<T>(value: string): T {
  return JSON.parse(decryptJson<string>(value), BufferJSON.reviver) as T;
}

export async function createPostgresAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}> {
  const stored = await prisma.whatsAppAuthCredential.findUnique({ where: { accountId } });
  const creds = stored ? decode<AuthenticationCreds>(stored.encryptedCredentials) : initAuthCreds();

  const saveCreds = async () => {
    await prisma.whatsAppAuthCredential.upsert({
      where: { accountId },
      create: { accountId, encryptedCredentials: encode(creds) },
      update: { encryptedCredentials: encode(creds), version: { increment: 1 } },
    });
  };

  if (!stored) await saveCreds();

  const keys: AuthenticationState['keys'] = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      if (ids.length === 0) return {};
      const result = await prisma.whatsAppSignalKey.findMany({
        where: { accountId, keyType: type, keyId: { in: ids } },
      });
      return Object.fromEntries(result.map((row) => [row.keyId, decode<SignalDataTypeMap[T]>(row.encryptedValue)])) as {
        [id: string]: SignalDataTypeMap[T];
      };
    },
    set: async (data: SignalDataSet) => {
      await prisma.$transaction(async (tx) => {
        for (const [type, values] of Object.entries(data)) {
          for (const [keyId, value] of Object.entries(values ?? {})) {
            if (value === null) {
              await tx.whatsAppSignalKey.deleteMany({ where: { accountId, keyType: type, keyId } });
            } else {
              await tx.whatsAppSignalKey.upsert({
                where: { accountId_keyType_keyId: { accountId, keyType: type, keyId } },
                create: { accountId, keyType: type, keyId, encryptedValue: encode(value) },
                update: { encryptedValue: encode(value) },
              });
            }
          }
        }
      });
    },
    clear: async () => {
      await prisma.whatsAppSignalKey.deleteMany({ where: { accountId } });
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
    clear: async () => {
      await prisma.$transaction([
        prisma.whatsAppAuthCredential.deleteMany({ where: { accountId } }),
        prisma.whatsAppSignalKey.deleteMany({ where: { accountId } }),
      ]);
    },
  };
}
