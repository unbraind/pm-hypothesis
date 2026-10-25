# Investigation records and invariants

The package uses public pm SDK APIs for schema, settings, native items, parent links, comments, complete-corpus certification and journaled conditional mutation. There is no private store, Git subprocess or diagnostic executor.

## Records

`open` creates a native Question or attaches to a native Question/Issue. Default SDK trackers omit Question/Test types, so `open` registers those types and two optional string fields through the schema SDK. Existing incompatible fields refuse.

`hypothesis_state` is the authoritative version-1 envelope on the investigation: monotonic revision, hypotheses with exact equality predictions, original observations with current admission, and an optional revision-bound conclusion. One complete item read supplies the entire logical snapshot. The matrix is never persisted, so withdrawal cannot leave stale cached eliminations.

Linked Question hypotheses and linked Test observations hold immutable `hypothesis_record` source envelopes. Original fact time uses an explicit ISO time or the native source record's creation time. Attribution uses SDK author precedence and tracker settings. The owner's admission may change while its original Test provenance remains intact. Native comments record owner changes in the same conditional mutation. They contain record ids rather than repeated untrusted fact bodies.

Stable ids hash intent with an optional caller operation identity. Prefix normalization follows tracker settings. Exact repeated intent is idempotent; a separate repeated event needs a separate operation identity. Both original data and prediction equality remain byte-sensitive. Rendering escapes terminal controls and markup characters without changing stored facts; nested data is always structured output, never an executable prompt.

## Matrix and conclusion

For each hypothesis, every admitted observation matching a prediction key but differing in value is an eliminating witness. Disputed/withdrawn facts never eliminate. An observation of an unrelated key never eliminates. Multiple contradictory admitted facts remain visible: the package does not select a convenient truth.

A hypothesis with witnesses is eliminated. With no witnesses it is unknown when any prediction key has no admitted observation, or it has no predictions. Otherwise it is viable. Unknown and viable both survive; missing facts never remove a possible cause. Withdrawal recomputes from all remaining admissions, restoring exactly the hypotheses that have no remaining witness.

Conclusion validates the full snapshot again on each retry. The selected cause must survive, and every other viable/unknown explanation must be explicitly acknowledged by id. A conclusion is an investigator decision, not causal proof. Its basis revision becomes stale after any later hypothesis or observation change.

## Next request

Consider unobserved prediction keys on surviving explanations. For each key, group explanations by predicted exact value. Count unordered pairs with different declared values; unspecified explanations remain in a separate list and do not count as a proven split. Choose the highest pair count, then the shortest UTF-8 key, then English lexical order. The result shows each predicted value group and its hypothesis ids. A zero-score candidate is not a discriminating request, so return null when none exist. Length is a deterministic observation-size proxy, not a measured execution cost.

## Conditional mutation and recovery

Each SDK journal plan contains exactly one target. An immutable source record is established first; current source identity, parent and type are checked before and after an SDK create/recovery. A failed source check prevents dependent owner work. A source created before interruption may exist before admission; an unreferenced source cannot eliminate anything. Retrying adopts only the exact current source payload.

Owner changes use the exact current registered field as a lock-held SDK match precondition; initialization matches current native updated_at when no owner field exists. The owner revision increments with each logical mutation. Every retry reads the current owner and recomputes the operation. No saved multi-target plan is replayed, no derived target updates are needed, and unchanged is determined from a current read. A changed explicit expected revision refuses instead of rebasing. No-op retries append no comments or observations.

Transaction ids include the current precondition and desired envelope. An interrupted unapplied owner intent whose precondition changed gets a fresh plan. The obsolete SDK runtime journal remains outside tracked data; it is never replayed over a new snapshot. Terminal SDK journal cleanup belongs to the host. Do not replay a stale raw SDK plan to recover a package operation: rerun the package operation with the same intent identity.

Tests inject a competing real conditional SDK writer at every package boundary and every SDK transaction transition of observe/withdraw/conclude. Writers queued inside the workspace writer lock serialize. Explicit SDK interruption faults simulate crash boundaries without compensation; reruns validate current data and converge without duplicate records. An extra test adds a hypothesis between conclusion reads, requiring renewed acknowledgment. A seeded 100-set property corpus is persisted and read through real SDK trackers, independently checking the elimination equivalence.

## Budgets and limits

Matrices contain all witnesses. Resume rows prioritize next request, any conclusion, survivors with open predictions, then concise eliminating witness rows in rounds, so one witness for each eliminated explanation precedes additional witnesses. A deterministic prefix fits the requested budget. The receipt distinguishes complete source reads from withheld output rows and gives a restoration command. Empty output cannot silently assert complete data. Token estimation is the ceiling of the larger default host JSON/TOON UTF-8 representation divided by four, including the receipt and its own counter. It is an estimate, not a model tokenizer.

Text inputs have a limit of 8,192 characters and each hypothesis has 1–1,000 distinct predictions. Budgets range from 1 to 1,000,000 estimated tokens; extremely small budgets refuse. CAS retries are bounded at twelve. Matrix work is proportional to declared predictions times admitted observations; the atomic owner favors compact incident sets rather than unbounded event streams.

Optional evidence citations are retained as provenance with a host-availability receipt; their contents and freshness are owned by pm-evidence. The package never imports it or executes its commands. No confidence estimate, model output or missing evidence constitutes an eliminating fact.

## Backend boundary

The SDK exposes host-bound reads and a workspace transaction service, but the item mutation helper takes a filesystem tracker root and lock-held field match. That SDK gap prevents an honest claim of conditional Postgres/MCP mutation conformance. This package certifies filesystem trackers with and without Git, supports injected host read clients, and never bypasses SDK history or writes raw storage. Remote mutation certification must wait for the host's authoritative conditional item capability; the package must refuse unsupported transports before effects when such transports are supplied. No remote backend is accessed by this implementation or its proofs.
