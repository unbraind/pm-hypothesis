import { createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { add, conclude, matrix, nextRequest, observe, open, resumePacket, show } from './hypothesis.ts';
import { HypothesisError, requireInput, wire } from './core.ts';
import { FIELDS } from './store.ts';

/** Refuse absent operands without coercing arrays or private diagnostics. */
function text(value: unknown): string { requireInput(typeof value === 'string', 'Required text operand is missing'); return value; }
/** Normalize repeated CLI flags without changing comma-containing data. */
function texts(value: unknown): string[] { if (value === undefined) return []; return (Array.isArray(value) ? value : [value]).map(text); }
/** Parse a single exact-equality prediction; values may themselves contain equals signs. */
export function prediction(value: string) { const index = value.indexOf('='); requireInput(index > 0 && index < value.length - 1, 'Prediction needs observation=value'); return { observation: value.slice(0, index), value: value.slice(index + 1) }; }
/** Dispatch thin host commands and retain native TOON/JSON rendering and exit behavior. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    const flags = ctx.options;
    const options = { workspace: ctx.pm_root, author: ctx.global.author, client: ctx.sdk?.client, operationId: flags.operation === undefined ? undefined : text(flags.operation), expectedRevision: flags.expectedRevision === undefined ? undefined : Number(flags.expectedRevision) };
    if (options.expectedRevision !== undefined) requireInput(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision >= 0, 'Expected revision must be a nonnegative integer');
    if (command === 'open') return await open(text(ctx.args[0]), { ...options, item: flags.item === undefined ? undefined : text(flags.item) });
    const investigation = text(ctx.args[0]);
    const bounded = { ...options, budget: flags.budget === undefined ? undefined : Number(flags.budget) };
    if (command === 'add') return await add(investigation, text(ctx.args[1]), texts(flags.predict).map(prediction), options);
    if (command === 'observe') return await observe(investigation, ctx.args[1] ?? '', ctx.args[2] ?? '', { ...options, evidence: flags.evidence === undefined ? undefined : text(flags.evidence), how: flags.how === undefined ? undefined : text(flags.how), when: flags.when === undefined ? undefined : text(flags.when), status: flags.disputed === true ? 'disputed' : 'admitted', withdraw: flags.withdraw === undefined ? undefined : text(flags.withdraw) });
    if (command === 'matrix') return await matrix(investigation, bounded);
    if (command === 'next') return await nextRequest(investigation, options);
    if (command === 'show') return await show(investigation, options);
    if (command === 'resume') return await resumePacket(investigation, bounded);
    if (command === 'conclude') return await conclude(investigation, text(flags.cause), text(flags.reason), { ...options, acceptViable: texts(flags.acceptViable) });
    throw new HypothesisError('invalid', 'Unknown hypothesis command', 'Read pm hypothesis --help');
  } catch (error) {
    const refusal = error instanceof HypothesisError ? error : new HypothesisError('sdk', 'Investigation SDK operation failed', 'Check pm health, tracker access and schema; retry the same operation');
    throw createPmCliExpectedError(`hypothesis ${refusal.code}: ${refusal.message}. Remedy: ${refusal.remedy}`, { exitCode: ['conflict', 'declaration_mismatch'].includes(refusal.code) ? 3 : 2, context: { code: refusal.code, ...refusal.details } });
  }
}
/** Register documented host commands and package-owned scalar fields. */
export function register(api: ExtensionApi): void {
  api.registerItemFields(FIELDS);
  const definitions = [
    ['open', ['title'], ['item', 'operation'], [], 'Open a native investigation', 'pm hypothesis open "CI fails"'],
    ['add', ['investigation', 'statement'], ['predict', 'operation', 'expected-revision'], [], 'Declare a competing explanation', 'pm hypothesis add inv-id "Missing lockfile" --predict "lockfile=absent"'],
    ['observe', ['investigation', 'observation', 'value'], ['evidence', 'withdraw', 'how', 'when', 'operation', 'expected-revision'], ['disputed'], 'Admit or withdraw a fact', 'pm hypothesis observe inv-id lockfile present --how "CI log"'],
    ['matrix', ['investigation'], ['budget'], [], 'Compute admitted-contradiction witnesses', 'pm hypothesis matrix inv-id --budget 1000'],
    ['next', ['investigation'], [], [], 'Suggest the next discriminating observation', 'pm hypothesis next inv-id'],
    ['resume', ['investigation'], ['budget'], [], 'Bound investigation handoff context', 'pm hypothesis resume inv-id --budget 1500'],
    ['show', ['investigation'], [], [], 'Restore the complete matrix, records and conclusion', 'pm hypothesis show inv-id --json'],
    ['conclude', ['investigation'], ['cause', 'reason', 'accept-viable', 'expected-revision'], [], 'Conclude with explicit alternative acknowledgment', 'pm hypothesis conclude inv-id --cause hypothesis-id --reason "Admitted facts"'],
  ] as const;
  for (const format of ['toon', 'json'] as const) api.registerRenderer(format, ctx => wire(ctx.result, format), { commands: definitions.map(([name]) => `hypothesis ${name}`) });
  for (const [name, args, strings, booleans, description, example] of definitions) {
    const flags: FlagDefinition[] = [...strings.map(flag => ({ long: `--${flag}`, description: `${flag}; example: ${example}`, value_type: 'string' as const, value_name: flag, repeatable: flag === 'predict' || flag === 'accept-viable' })), ...booleans.map(flag => ({ long: `--${flag}`, description: `${flag}; example: ${example}`, value_type: 'boolean' as const }))];
    api.registerCommand(defineCommand({ name: `hypothesis ${name}`, description, intent: 'Project management = context management: preserve investigations across handoffs', arguments: args.map((arg, index) => ({ name: arg, description: `${arg}; example: ${example}`, required: name !== 'observe' || index === 0 })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
