export interface ParsedCli {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith('--no-')) {
      flags[token.slice(5)] = false;
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex >= 0) {
      flags[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
      continue;
    }

    flags[key] = true;
  }

  return { flags, positionals };
}

export function getStringFlag(parsed: ParsedCli, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function getBooleanFlag(parsed: ParsedCli, name: string, fallback = false): boolean {
  const value = parsed.flags[name];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  return fallback;
}

export function getIntegerFlag(parsed: ParsedCli, name: string): number | undefined {
  const value = getStringFlag(parsed, name);
  if (!value) {
    return undefined;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Flag --${name} must be an integer. Received "${value}".`);
  }

  return parsedValue;
}

export function requireNoUnexpectedPositionals(parsed: ParsedCli, context: string): void {
  if (parsed.positionals.length === 0) {
    return;
  }

  throw new Error(
    `${context} does not accept positional arguments. Unexpected: ${parsed.positionals.join(' ')}`,
  );
}

export function getLegacyTarget(parsed: ParsedCli): string | undefined {
  if (parsed.positionals.length === 0) {
    return undefined;
  }

  return parsed.positionals.join(' ').trim();
}
