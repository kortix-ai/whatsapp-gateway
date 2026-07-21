import { fetchLatestBaileysVersion, type WAVersion } from 'baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { version: WAVersion; at: number } | undefined;

function pinnedVersion(): WAVersion | undefined {
  if (!config.WA_WEB_VERSION) return undefined;
  return config.WA_WEB_VERSION.split(',').map((part) => Number(part.trim())) as WAVersion;
}

/**
 * The WhatsApp Web version to present. A stale version is a real flag ("client
 * outdated"), so unless WA_WEB_VERSION pins one, track the current version from
 * the community-maintained list (GitHub, not WhatsApp — no IP exposure), cached
 * for six hours. fetchLatestBaileysVersion returns a bundled fallback on failure.
 */
export async function resolveWaVersion(): Promise<WAVersion> {
  const pinned = pinnedVersion();
  if (pinned) return pinned;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.version;
  const { version, isLatest, error } = await fetchLatestBaileysVersion();
  cache = { version, at: Date.now() };
  if (error) logger.warn({ error, version }, 'Using bundled WhatsApp Web version; latest fetch failed');
  else logger.info({ version, isLatest }, 'Resolved WhatsApp Web version');
  return version;
}
