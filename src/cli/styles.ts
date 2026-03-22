import chalk from 'chalk';

export const icons = {
  success: chalk.green('✓'),
  error: chalk.red('✗'),
  warning: chalk.yellow('⚠'),
};

export function sectionHeader(text: string): string {
  return chalk.bold.underline(text);
}

export function infoLabel(text: string): string {
  return chalk.cyan(text);
}

export function valueText(text: string | number): string {
  return chalk.white.bold(String(text));
}

export function dimText(text: string | number): string {
  return chalk.dim(String(text));
}

export function successText(text: string): string {
  return chalk.green.bold(text);
}

export function errorText(text: string): string {
  return chalk.red.bold(text);
}

export function warningText(text: string): string {
  return chalk.yellow(text);
}

export function statusColor(status: string, width?: number): string {
  const value = width ? status.padEnd(width) : status;

  switch (status.toLowerCase()) {
    case 'completed':
    case 'ready':
    case 'active':
    case 'connected':
    case 'success':
      return chalk.green.bold(value);
    case 'running':
    case 'processing':
    case 'pending':
    case 'aggregating':
      return chalk.yellow(value);
    case 'failed':
    case 'error':
      return chalk.red.bold(value);
    default:
      return chalk.dim(value);
  }
}

export function dimensionColor(value: number): string {
  const pct = `${(value * 100).toFixed(0)}%`;
  if (value > 0.7) return chalk.green.bold(pct);
  if (value < 0.3) return chalk.red.bold(pct);
  return chalk.yellow(pct);
}

export function progressBar(progress: number, width: number = 40): string {
  const filled = Math.round((progress / 100) * width);
  return `${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(width - filled))}`;
}
