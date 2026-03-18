import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Terminal colors (disabled when not a TTY)
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY ?? false;

const wrap =
  (code: string) =>
  (s: string): string =>
    isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;

export const color = {
  green: wrap('32'),
  red: wrap('31'),
  cyan: wrap('36'),
  dim: wrap('2'),
  bold: wrap('1'),
  yellow: wrap('33')
};

// ---------------------------------------------------------------------------
// Log helpers
// ---------------------------------------------------------------------------

export const ok = (msg: string): void => {
  console.log(`  ${color.green('✓')} ${msg}`);
};

export const fail = (msg: string): never => {
  console.error(`  ${color.red('✗')} ${msg}`);
  process.exit(1);
};

export const info = (msg: string): void => {
  console.log(`  ${color.dim(msg)}`);
};

export const warn = (msg: string): void => {
  console.log(`  ${color.yellow('⚠')} ${msg}`);
};

export const blank = (): void => {
  console.log();
};

export const title = (msg: string): void => {
  blank();
  console.log(`  ${color.bold(msg)}`);
  blank();
};

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

export interface SelectChoice<T = string> {
  label: string;
  detail?: string;
  value: T;
}

export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` ${color.dim(`[${defaultValue}]`)}` : '';

  return new Promise((resolve) => {
    rl.question(`  ${color.cyan('?')} ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export function promptSelect<T>(question: string, choices: SelectChoice<T>[]): Promise<T> {
  return new Promise((resolve) => {
    console.log(`  ${color.cyan('?')} ${question}`);
    blank();

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i]!;
      const detail = choice.detail ? `  ${color.dim(choice.detail)}` : '';
      console.log(`    ${color.bold(`${String(i + 1)})`)} ${choice.label}${detail}`);
    }

    blank();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const defaultLabel = color.dim('[1]');
    rl.question(`  ${color.cyan('?')} Enter number (1-${String(choices.length)}) ${defaultLabel}: `, (answer) => {
      rl.close();
      const raw = answer.trim() || '1';
      const index = parseInt(raw, 10) - 1;

      if (isNaN(index) || index < 0 || index >= choices.length) {
        fail('Invalid selection.');
      }

      resolve(choices[index]!.value);
    });
  });
}
