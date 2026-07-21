import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAgentSkill } from './skill.js';
import { buildAgentCapabilities } from './skill.js';

describe('agent skill', () => {
  it('serves a generic skill without credentials', () => {
    const skill = buildAgentSkill();
    expect(skill).toContain('name: whatsapp-gateway');
    expect(skill).not.toContain("export WHATSAPP_GATEWAY_API_KEY='");
  });

  it('keeps credentials out of the generic skill', () => {
    expect(buildAgentSkill()).not.toContain('wag_test');
    expect(buildAgentSkill()).toContain('/openapi.json');
    expect(buildAgentSkill()).toContain('/v1/capabilities.md');
  });

  it('documents every custom v1 REST route', () => {
    const source = readFileSync(fileURLToPath(new URL('./api/app.ts', import.meta.url)), 'utf8');
    const staticSkill = readFileSync(fileURLToPath(new URL('../skills/whatsapp-gateway/SKILL.md', import.meta.url)), 'utf8');
    const routes = [...source.matchAll(/app\.(?:get|post|patch|delete)\('(\/v1\/[^']+)'/g)]
      .map((match) => match[1]?.replace(/:([A-Za-z]+)/g, '{$1}'))
      .filter((route): route is string => Boolean(route));
    const skill = `${buildAgentSkill()}\n${buildAgentCapabilities()}`;
    for (const route of routes) {
      expect(skill, `generated skill missing ${route}`).toContain(route);
      expect(staticSkill, `installable skill missing ${route}`).toContain(route);
    }
  });
});
