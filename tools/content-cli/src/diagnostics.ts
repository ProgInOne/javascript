import { relative } from 'node:path';
import type { z } from 'zod';

export interface Diagnostic {
  level: 'error' | 'warning';
  file: string;
  message: string;
}

export class Diagnostics {
  readonly items: Diagnostic[] = [];
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #rel(file: string) {
    return relative(this.#root, file) || file;
  }

  error(file: string, message: string): void {
    this.items.push({ level: 'error', file: this.#rel(file), message });
  }

  warn(file: string, message: string): void {
    this.items.push({ level: 'warning', file: this.#rel(file), message });
  }

  zod(file: string, error: z.ZodError): void {
    for (const issue of error.issues) {
      this.error(file, `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  get errorCount(): number {
    return this.items.filter((d) => d.level === 'error').length;
  }

  get warningCount(): number {
    return this.items.filter((d) => d.level === 'warning').length;
  }
}
