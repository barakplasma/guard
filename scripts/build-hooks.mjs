import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as z from 'zod';

await mkdir('pb_hooks', { recursive: true });

const HookConfig = z.object({
  timezone: z.string().min(1),
  rotationCron: z.string().regex(/^(\S+\s+){4}\S+$/),
});

const config = HookConfig.parse({
  timezone: 'Asia/Jerusalem',
  rotationCron: '0 12 * * *',
});

const template = await readFile('pb_hooks_src/temp_login.pb.js', 'utf8');
const output = template
  .replaceAll('__ROTATION_TIMEZONE__', config.timezone)
  .replaceAll('__ROTATION_CRON__', config.rotationCron);

await writeFile('pb_hooks/temp_login.pb.js', output);
