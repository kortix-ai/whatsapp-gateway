import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const path = new URL('../skills/whatsapp-gateway/SKILL.md', import.meta.url);
const source = await readFile(path, 'utf8');
const match = source.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) throw new Error('SKILL.md must start with YAML frontmatter');
const entries = Object.fromEntries(match[1].split('\n').map((line) => {
  const separator = line.indexOf(':');
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}));
if (!/^[a-z0-9-]{1,64}$/.test(entries.name ?? '')) throw new Error('Skill name must use lowercase letters, digits, and hyphens');
if (!entries.description) throw new Error('Skill description is required');
if (Object.keys(entries).some((key) => !['name', 'description'].includes(key))) throw new Error('Only name and description are allowed in skill frontmatter');
process.stdout.write('Skill is valid!\n');
