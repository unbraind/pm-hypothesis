import { PmCliError, EXIT_CODE, previewItemMutations, readSettings, resolveRuntimeStatusRegistry, SETTINGS_DEFAULTS } from '@unbrained/pm-cli/sdk';
import type { CommitItemMutationsOptions, GetResult, PmClient, SchemaListResult, SchemaListFieldsResult } from '@unbrained/pm-cli/sdk';
import { digest, HypothesisError } from './core.ts';

/** One immutable native schema/settings view carried with the item preconditions. */
export interface AdmissionSchema {
  types: SchemaListResult['builtin'];
  fields: SchemaListFieldsResult['fields'];
  statuses: ReturnType<typeof resolveRuntimeStatusRegistry>;
  signature: string;
}

/** Read authoritative SDK registries without persisting generated projection metadata. */
export async function admissionSchema(client: PmClient, workspace: string, remote = false): Promise<AdmissionSchema> {
  const listed = await client.schemaList(); const fields = (await client.schemaListFields()).fields;
  const types = [...listed.builtin, ...listed.custom, ...listed.extension];
  const configuration = remote ? undefined : await readSettings(workspace);
  const statuses = resolveRuntimeStatusRegistry({ ...(configuration?.schema ?? SETTINGS_DEFAULTS.schema), statuses: [...listed.statuses.builtin, ...listed.statuses.custom].map(status => ({ ...status, roles: status.roles as AdmissionSchema['statuses']['definitions'][number]['roles'] })) });
  return { types, fields, statuses, signature: digest([types, fields, statuses.definitions, configuration]) };
}

/** Native source admission follows registered status meaning, including the reserved withdrawal identity. */
export function usableSource(item: GetResult['item'], schema: AdmissionSchema): boolean {
  return schema.types.some(type => type.name === item.type) && item.closed_at === undefined && usableStatus(item.status, schema);
}

/** Resolve native status aliases and every terminal role before admission. */
export function usableStatus(value: string | undefined, schema: AdmissionSchema): boolean {
  if (value === undefined) return false;
  const status = schema.statuses.alias_to_id.get(value) ?? value;
  const definition = schema.statuses.by_id.get(status);
  return definition !== undefined && status !== schema.statuses.alias_to_id.get('withdrawn') && !schema.statuses.terminal_statuses.has(status) && !definition.roles.some(role => role === 'default_close' || role === 'default_cancel' || role.startsWith('terminal'));
}

/** Reject a schema or policy edit rather than rebasing the captured admission. */
export function sameSchema(expected: AdmissionSchema, actual: AdmissionSchema): void {
  if (expected.signature !== actual.signature) throw new HypothesisError('conflict', 'Native schema or status roles changed during admission', 'Read the current schema and retry as a fresh invocation');
}

/** Execute native lifecycle validation on the exact ordered batch, with no source effects. */
export async function validateBatch(input: Pick<CommitItemMutationsOptions, 'pmRoot' | 'author' | 'transactionId' | 'mutations'>) {
  try {
    const receipt = await previewItemMutations(input);
    if (!receipt.validated) throw new HypothesisError('conflict', 'The preview adopted a completed journal instead of validating the batch', 'Plan a fresh transaction identity against current preconditions');
    return receipt;
  } catch (error) {
    if (error instanceof HypothesisError) throw error;
    if (error instanceof PmCliError && error.exitCode === EXIT_CODE.CONFLICT) throw new HypothesisError('conflict', 'Tracker changed during native batch validation', 'Read the current owner, sources and schema, then retry');
    throw new HypothesisError('validation', 'Native SDK batch validation refused the proposed records', 'Inspect native item types, fields, status roles and required creation fields; repair the schema or change the intent');
  }
}
