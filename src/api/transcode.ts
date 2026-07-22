/**
 * WhatsApp voice notes arrive as `audio/ogg; codecs=opus`. Almost nothing that
 * consumes audio downstream accepts opus — model audio inputs take mp3, wav,
 * m4a, flac or webm — so handing the raw bytes over produces the failure this
 * exists to fix: the recipient downloads a voice message, cannot decode it, and
 * asks the sender to type it out instead.
 *
 * Transcode to mp3 on the way out so a voice note is usable by default. The raw
 * bytes stay one query parameter away for anyone who wants them.
 */
import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

/** Anything larger is refused rather than buffered twice in memory. */
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const TRANSCODE_TIMEOUT_MS = 60_000;

export class TranscodeError extends Error {}

/** True for the formats consumers reliably cannot decode. */
export function needsTranscode(mimetype: string | null | undefined): boolean {
  const value = (mimetype ?? '').toLowerCase();
  return value.includes('ogg') || value.includes('opus');
}

/**
 * Decode `input` with ffmpeg and return mp3 bytes.
 *
 * stdin/stdout are piped rather than using temp files: the buffer is already in
 * memory and a voice note is small, so a round trip through disk would add
 * failure modes (cleanup, permissions, disk pressure) for nothing.
 */
export async function toMp3(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new TranscodeError('Audio is too large to transcode');
  }
  return new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-map_metadata', '-1',
      '-ac', '1',           // voice notes are mono; keep them that way
      '-b:a', '64k',        // speech, not music
      '-f', 'mp3',
      'pipe:1',
    ]);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ffmpeg.kill('SIGKILL');
      reject(new TranscodeError('Transcode timed out'));
    }, TRANSCODE_TIMEOUT_MS);
    timer.unref();

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    ffmpeg.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // ENOENT here means ffmpeg is missing from the image entirely.
    ffmpeg.on('error', (error) => fail(new TranscodeError(`ffmpeg unavailable: ${error.message}`)));
    // The writer races the process: if ffmpeg exits early, stdin is already gone.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const body = Buffer.concat(out);
      if (code !== 0 || body.length === 0) {
        const detail = Buffer.concat(err).toString('utf8').slice(0, 300).trim();
        logger.warn({ code, detail }, 'Audio transcode failed');
        reject(new TranscodeError(detail || `ffmpeg exited with ${code}`));
        return;
      }
      resolve(body);
    });

    ffmpeg.stdin.end(input);
  });
}
