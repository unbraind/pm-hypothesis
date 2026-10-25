import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
import * as api from './src/hypothesis.ts';
import { guarded } from './src/core.ts';
/** Open or attach a native investigation through the public SDK. */
export const open = guarded(api.open);
/** Declare a linked explanation with explicit equality predictions. */
export const add = guarded(api.add);
/** Admit/dispute or withdraw a fact with conditional revision semantics. */
export const observe = guarded(api.observe);
/** Read a bounded auditable hypothesis matrix in process. */
export const matrix = guarded(api.matrix);
/** Choose a discriminating observation without executing it. */
export const nextRequest = guarded(api.nextRequest);
/** Build bounded investigation handoff context with an omission receipt. */
export const resumePacket = guarded(api.resumePacket);
/** Restore complete matrix, source facts and conclusion without packet omissions. */
export const show = guarded(api.show);
/** Record an explicit revision-bound conclusion and acknowledged alternatives. */
export const conclude = guarded(api.conclude);
/** Typed refusals and deterministic byte-cost estimator. */
export { HypothesisError, tokens } from './src/core.ts';
/** Native record, prediction, witness, request, receipt and integration contracts. */
export type { Options, ObserveOptions, Prediction, Hypothesis, Observation, Investigation, Conclusion, MatrixRow, Witness, Request, Packet, ResumeRow, Boundary } from './src/types.ts';
/** Activate differential investigation commands and registered item fields. */
export default defineExtension({ name: 'pm-hypothesis', version: '2026.10.25', description: 'Durable competing explanations and observations', activate: register });
