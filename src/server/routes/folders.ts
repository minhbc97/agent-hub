import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../http/errors.ts';
import { on } from '../http/router.ts';

const run = promisify(execFile);
const WINDOWS_PICKER = fileURLToPath(new URL('../../../scripts/pick-folder.ps1', import.meta.url));

type PickerCommand = { file: string; args: string[] };

function pickerCommands(): PickerCommand[] {
  switch (process.platform) {
    case 'win32':
      return [
        { file: 'powershell.exe', args: ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_PICKER] },
      ];
    case 'darwin':
      return [
        {
          file: 'osascript',
          args: [
            '-e',
            'try',
            '-e',
            'POSIX path of (choose folder)',
            '-e',
            'on error number -128',
            '-e',
            'return ""',
            '-e',
            'end try',
          ],
        },
      ];
    case 'linux':
      return [
        { file: 'zenity', args: ['--file-selection', '--directory'] },
        { file: 'kdialog', args: ['--getexistingdirectory'] },
      ];
    default:
      return [];
  }
}

async function pickFolder(): Promise<string | null> {
  for (const command of pickerCommands()) {
    try {
      const { stdout } = await run(command.file, command.args, { windowsHide: true, maxBuffer: 4096 });
      return stdout.replace(/\r?\n$/, '') || null;
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') continue;
      if (process.platform === 'linux' && code === 1) return null;
      throw new HttpError(500, 'errors.folderPickerFailed');
    }
  }
  throw new HttpError(501, 'errors.folderPickerUnavailable');
}

on('POST', '/api/folders/pick', async () => ({ path: await pickFolder() }));
