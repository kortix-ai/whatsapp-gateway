import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { baileysActions } from './actions.js';

const dedicatedSocketMethods = ['requestPairingCode', 'logout'];

// These are transport, crypto, retry, event-injection, or raw protocol
// primitives. Exposing them would let a tenant bypass the durable command
// boundary or corrupt shared authentication and Signal state.
const intentionallyInternalSocketMethods = [
  'sendMessageAck',
  'sendRetryRequest',
  'issuePrivacyTokens',
  'assertSessions',
  'relayMessage',
  'refreshMediaConn',
  'getMediaHost',
  'waUploadToServer',
  'sendPeerDataOperationMessage',
  'createParticipantNodes',
  'getUSyncDevices',
  'upsertMessage',
  'appPatch',
  'cleanDirtyBits',
  'generateMessageTag',
  'query',
  'waitForMessage',
  'waitForSocketOpen',
  'sendRawMessage',
  'sendNode',
  'end',
  'registerSocketEndHandler',
  'onUnexpectedError',
  'uploadPreKeys',
  'uploadPreKeysToServerIfRequired',
  'digestKeyBundle',
  'rotateSignedPreKey',
  'updateServerTimeOffset',
  'sendUnifiedSession',
  'waitForConnectionUpdate',
  'sendWAMBuffer',
  'executeUSyncQuery',
];

function installedSocketMethods(): string[] {
  const socketPath = fileURLToPath(new URL('./Socket/index.d.ts', import.meta.resolve('baileys')));
  const program = ts.createProgram([socketPath], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2023,
    skipLibCheck: true,
  });
  const source = program.getSourceFile(socketPath);
  if (!source) throw new Error('Could not load the installed Baileys socket declaration');
  const checker = program.getTypeChecker();
  let methods: string[] | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'makeWASocket') {
      const signature = checker.getTypeAtLocation(node.name).getCallSignatures()[0];
      if (!signature) throw new Error('Could not inspect the installed Baileys socket factory');
      const socket = checker.getReturnTypeOfSignature(signature);
      methods = socket.getProperties()
        .filter((property) => checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? node).getCallSignatures().length > 0)
        .map((property) => property.getName());
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!methods) throw new Error('Could not find the installed Baileys socket factory');
  return methods;
}

describe('managed Baileys action registry', () => {
  it('only maps to methods exported by the installed Baileys socket', () => {
    const socketTypes = readFileSync(fileURLToPath(new URL('./Socket/index.d.ts', import.meta.resolve('baileys'))), 'utf8');
    for (const [name, action] of Object.entries(baileysActions)) {
      expect(socketTypes, `${name} maps to missing ${action.method}`).toMatch(new RegExp(`\\b${action.method}:`));
    }
  });

  it('documents and scopes every action', () => {
    expect(Object.keys(baileysActions).length).toBeGreaterThan(115);
    for (const action of Object.values(baileysActions)) {
      expect(action.args).toMatch(/^\[/);
      expect(action.description.length).toBeGreaterThan(10);
      expect(action.permission.resource).toBeTruthy();
    }
  });

  it('classifies every callable method on the installed Baileys socket', () => {
    const classified = new Set([
      ...Object.values(baileysActions).map((action) => action.method),
      ...dedicatedSocketMethods,
      ...intentionallyInternalSocketMethods,
    ]);
    expect(new Set(installedSocketMethods())).toEqual(classified);
  });
});
