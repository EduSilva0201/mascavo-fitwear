import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const scenarios = JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url), 'utf8'));
export function pending(group) {
  for (const name of scenarios[group])
    test.todo(`${group}: ${name} [business feature not implemented]`);
}
