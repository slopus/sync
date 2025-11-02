import { FullSchemaDefinition, InferItemState, InferMutationInput, InferMutations, InferServerItemState, Schema, CollectionType, ExtractSchemaDefinition } from "./schema";
import { produce } from 'immer';
import { createId } from '@paralleldrive/cuid2';
import { FieldValue, Version } from "./types";

/**
 * Helper type to check if a collection has versioning enabled
 */
type HasVersionTracking<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> =
    ExtractSchemaDefinition<TSchema>[TCollection] extends CollectionType<infer TFields>
        ? ExtractSchemaDefinition<TSchema>[TCollection] extends { versioned: true }
            ? true
            : false
        : false;

/**
 * State type for the sync engine (client-side representation)
 * Maps collection names to records of items indexed by ID
 * All fields are unwrapped (plain values)
 */
export type SyncState<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]: Record<string, InferItemState<Schema<T>, K>>
};

/**
 * Server snapshot type (server-side internal representation)
 * Contains wrapped field values with versions for LWW conflict resolution
 * Version tracking is per-object, not global
 */
export type ServerSnapshot<T extends FullSchemaDefinition> = {
    /** Collections containing server item states (wrapped fields with per-object versions) */
    [K in keyof T['types']]: Record<string, InferServerItemState<Schema<T>, K>>
};

/**
 * Pending mutation that has been applied locally but not yet confirmed by server
 *
 * This represents a mutation that is:
 * - Applied to the local state (optimistic update)
 * - Waiting for server confirmation (unless it's a local mutation)
 * - Will be rebased if server state changes
 *
 * Local mutations (isLocal: true):
 * - Applied locally but NOT sent to server
 * - Useful for UI-only state changes
 * - Filtered out from pendingMutations (use allMutations to see them)
 *
 * This is a discriminated union where the `input` type is strictly typed
 * based on the `name` field, enabling type-safe access to mutation data.
 *
 * @example
 * ```typescript
 * const schema = defineSchema({
 *   types: { todos: type({ fields: { title: mutableField<string>() } }) },
 *   mutations: {
 *     createTodo: z.object({ id: z.string(), title: z.string() }),
 *     deleteTodo: z.object({ id: z.string() })
 *   }
 * });
 *
 * const engine = sync(schema);
 * engine.mutate('createTodo', { id: '1', title: 'Test' });
 * engine.mutateLocal('deleteTodo', { id: '1' }); // Local-only
 *
 * // Type narrowing based on mutation name
 * for (const mutation of engine.allMutations) {
 *   if (mutation.name === 'createTodo') {
 *     // TypeScript knows: mutation.input is { id: string; title: string }
 *     console.log(mutation.input.title); // ✓ Type-safe
 *   } else if (mutation.name === 'deleteTodo') {
 *     // TypeScript knows: mutation.input is { id: string }
 *     console.log(mutation.input.id); // ✓ Type-safe
 *   }
 * }
 * ```
 */
export type PendingMutation<T extends FullSchemaDefinition> = {
    [M in InferMutations<Schema<T>>]: {
        /** Unique mutation ID (CUID2 format) */
        readonly id: string;
        /** Timestamp when the mutation was created (milliseconds since epoch) */
        readonly timestamp: number;
        /** Name of the mutation from the schema */
        readonly name: M;
        /** Input data for the mutation, strictly typed based on mutation name */
        readonly input: InferMutationInput<Schema<T>, M>;
        /**
         * Whether this is a local-only mutation
         * - true: mutation is NOT sent to server, filtered from pendingMutations
         * - false: mutation will be sent to server
         */
        readonly isLocal: boolean;
    }
}[InferMutations<Schema<T>>];

/**
 * Mutator function that applies a mutation to the state
 * Uses Immer for immutable updates - mutate the draft directly
 */
type Mutator<T extends FullSchemaDefinition> = (
    draft: SyncState<T>,
    input: unknown
) => void;

/**
 * Registry of mutation handlers
 */
type MutatorRegistry<T extends FullSchemaDefinition> = {
    [K in InferMutations<Schema<T>>]?: Mutator<T>
};

/**
 * Helper type to create a partial server update item
 * Ensures version is required when versioned=true, prohibited when versioned=false
 */
type PartialServerItem<T extends FullSchemaDefinition, TCollection extends keyof T['types']> =
    HasVersionTracking<Schema<T>, TCollection> extends true
        // When versioned=true: version is required
        ? { id: string; version: number } & Partial<Omit<InferItemState<Schema<T>, TCollection>, 'id'>>
        // When versioned=false: version is prohibited
        : { id: string; version?: never } & Partial<Omit<InferItemState<Schema<T>, TCollection>, 'id'>>;

/**
 * Partial server update - collections contain arrays of partial items
 * Each item must have an id, but other fields are optional
 * Version is REQUIRED when versioned=true, PROHIBITED when versioned=false (compile-time checked)
 */
export type PartialServerUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: Array<PartialServerItem<T, K>>
};

/**
 * Sync engine instance returned by sync()
 */
export interface SyncEngine<T extends FullSchemaDefinition> {
    /** Current computed state (serverState + pending mutations) */
    readonly state: SyncState<T>;

    /** Current server state (base truth from server) */
    readonly serverState: SyncState<T>;

    /**
     * List of pending mutations waiting for server confirmation
     * These mutations have been applied to local state but not yet confirmed
     * Excludes local mutations (use allMutations to see all mutations)
     * Read-only array to prevent external modification
     */
    readonly pendingMutations: ReadonlyArray<PendingMutation<T>>;

    /**
     * List of ALL mutations including local and pending mutations
     * Maintains insertion order
     * Read-only array to prevent external modification
     */
    readonly allMutations: ReadonlyArray<PendingMutation<T>>;

    /**
     * Apply a mutation locally
     * Creates a mutation ID and timestamp, adds to pending list, and rebases state
     * This mutation will be sent to the server
     */
    mutate<M extends InferMutations<Schema<T>>>(
        name: M,
        input: InferMutationInput<Schema<T>, M>
    ): void;

    /**
     * Apply a local-only mutation
     * Creates a mutation ID and timestamp, adds to mutations list, and rebases state
     * This mutation is NOT sent to the server (filtered from pendingMutations)
     * Useful for UI-only state changes
     */
    mutateLocal<M extends InferMutations<Schema<T>>>(
        name: M,
        input: InferMutationInput<Schema<T>, M>
    ): void;

    /**
     * Register a mutation handler
     * The handler receives an Immer draft and should mutate it directly
     */
    addMutator<M extends InferMutations<Schema<T>>>(
        name: M,
        handler: (draft: SyncState<T>, input: InferMutationInput<Schema<T>, M>) => void
    ): void;

    /**
     * Commit pending mutations (remove them from pending list)
     * This should be called when the server confirms mutations
     * Automatically rebases state after removal
     *
     * @param mutationIds - Single mutation ID or array of mutation IDs to commit
     */
    commit(mutationIds: string | string[]): void;

    /**
     * Update server state with partial items from server
     *
     * - Arrays of partial items (id required, other fields optional)
     * - If item exists: patches/merges fields into existing item
     * - If item is new and has all required fields: creates new item
     * - If item is new but missing required fields: ignores it
     * - Automatically rebases pending mutations after update
     */
    rebase(partialServerUpdate: PartialServerUpdate<T>): void;
}

/**
 * Create a sync engine for the given schema
 */
export function syncEngine<T extends FullSchemaDefinition>(schema: Schema<T>): SyncEngine<T> {

    // Create empty initial state (client representation)
    const createEmptyState = (): SyncState<T> => {
        const emptyState = {} as SyncState<T>;
        for (let collection of Object.keys(schema._schema.types)) {
            emptyState[collection as keyof T['types']] = {};
        }
        return emptyState;
    };

    // Create empty initial server snapshot (server representation)
    const createEmptySnapshot = (): ServerSnapshot<T> => {
        const emptySnapshot = {} as ServerSnapshot<T>;
        for (let collection of Object.keys(schema._schema.types)) {
            (emptySnapshot as Record<string, Record<string, unknown>>)[collection] = {};
        }
        return emptySnapshot;
    };

    // Internal state
    let serverSnapshot: ServerSnapshot<T> = createEmptySnapshot();
    let state: SyncState<T> = createEmptyState();
    // All mutations (both pending and local) in order
    const allPendingMutations: PendingMutation<T>[] = [];
    const mutators: MutatorRegistry<T> = {} as MutatorRegistry<T>;

    /**
     * Unwrap server snapshot to client state
     * Converts FieldValue<T> to plain T for all fields except id and version
     */
    const unwrapSnapshot = (snapshot: ServerSnapshot<T>): SyncState<T> => {
        const clientState = {} as SyncState<T>;

        for (const collectionName in snapshot) {
            const collectionKey = collectionName as keyof T['types'];
            const serverItems = snapshot[collectionKey];
            const clientItems: Record<string, unknown> = {};

            for (const itemId in serverItems) {
                const serverItem = serverItems[itemId] as Record<string, unknown>;
                const clientItem: Record<string, unknown> = {
                    id: serverItem.id, // id is not wrapped
                };

                // Unwrap all other fields (skip id and version)
                for (const fieldName in serverItem) {
                    if (fieldName === 'id' || fieldName === 'version') continue; // Skip unwrapped fields

                    const fieldValue = serverItem[fieldName] as FieldValue<unknown>;
                    clientItem[fieldName] = fieldValue.value;
                }

                clientItems[itemId] = clientItem;
            }

            clientState[collectionKey] = clientItems as Record<string, InferItemState<Schema<T>, typeof collectionKey>>;
        }

        return clientState;
    };

    /**
     * Rebase state by applying ALL mutations (including local) to unwrapped server state
     */
    const rebaseState = (): void => {
        // Start with unwrapped server snapshot
        const baseState = unwrapSnapshot(serverSnapshot);

        // Apply all mutations on top
        state = allPendingMutations.reduce(
            (currentState, mutation) => {
                const mutator = mutators[mutation.name];
                if (!mutator) {
                    console.warn(`No mutator registered for mutation: ${String(mutation.name)}`);
                    return currentState;
                }
                return produce(currentState, draft => {
                    mutator(draft as SyncState<T>, mutation.input);
                }) as SyncState<T>;
            },
            baseState
        );
    };

    return {
        get state() {
            return state;
        },

        get serverState() {
            // Return unwrapped server snapshot as client state
            return unwrapSnapshot(serverSnapshot);
        },

        get pendingMutations() {
            // Filter out local mutations and return readonly copy
            return allPendingMutations.filter(m => !m.isLocal) as ReadonlyArray<PendingMutation<T>>;
        },

        get allMutations() {
            // Return all mutations including local
            return allPendingMutations as ReadonlyArray<PendingMutation<T>>;
        },

        mutate(name, input) {
            // Create mutation metadata
            const mutation: PendingMutation<T> = {
                id: createId(),
                timestamp: Date.now(),
                name: name as InferMutations<Schema<T>>,
                input,
                isLocal: false,
            };

            // Add to mutations list
            allPendingMutations.push(mutation);

            // Rebase state
            rebaseState();
        },

        mutateLocal(name, input) {
            // Create local mutation metadata
            const mutation: PendingMutation<T> = {
                id: createId(),
                timestamp: Date.now(),
                name: name as InferMutations<Schema<T>>,
                input,
                isLocal: true,
            };

            // Add to mutations list (same array to maintain order)
            allPendingMutations.push(mutation);

            // Rebase state
            rebaseState();
        },

        addMutator(name, handler) {
            mutators[name] = handler as Mutator<T>;
        },

        commit(mutationIds) {
            // Normalize to array
            const idsToCommit = Array.isArray(mutationIds) ? mutationIds : [mutationIds];

            // Convert to Set for O(1) lookup
            const idsSet = new Set(idsToCommit);

            // Filter out committed mutations
            const originalLength = allPendingMutations.length;
            let i = allPendingMutations.length;
            while (i--) {
                if (idsSet.has(allPendingMutations[i].id)) {
                    allPendingMutations.splice(i, 1);
                }
            }

            // Only rebase if we actually removed something
            if (allPendingMutations.length !== originalLength) {
                rebaseState();
            }
        },

        rebase(partialServerUpdate) {
            // Helper to check if an item has all required fields defined
            // Local fields are NOT required from server (they use defaults)
            const isComplete = (item: Record<string, unknown>, collectionName: string): boolean => {
                const collectionFields = schema.collection(collectionName as keyof T['types']);
                if (!collectionFields) return false;

                // Check id and createdAt
                if (item.id === undefined || item.createdAt === undefined) {
                    return false;
                }

                // Check all schema-defined fields (except local fields)
                for (const fieldName in collectionFields) {
                    const field = collectionFields[fieldName];
                    // Skip local fields - they use default values
                    if (field.fieldType === 'local') continue;

                    if (item[fieldName] === undefined) {
                        return false;
                    }
                }

                return true;
            };

            // Merge partial server update into server snapshot with per-object versioning and field-level LWW
            serverSnapshot = produce(serverSnapshot, draft => {
                for (const collectionName in partialServerUpdate) {
                    const collectionKey = collectionName as keyof T['types'];
                    const partialItems = partialServerUpdate[collectionKey];
                    if (!partialItems) continue;

                    // TypeScript struggles with generic indexing in Immer drafts
                    const collection = (draft as Record<string, Record<string, unknown>>)[collectionName];
                    const collectionFields = schema.collection(collectionKey);
                    const collectionType = (schema._schema.types as Record<string, CollectionType>)[collectionName];
                    const versioned = collectionType.versioned;

                    for (const partialItem of partialItems) {
                        const itemId = partialItem.id;
                        const existingItem = collection[itemId] as Record<string, unknown> | undefined;

                        // Get incoming version (if provided and tracking enabled)
                        const incomingVersion = versioned && 'version' in partialItem
                            ? (partialItem as Record<string, unknown>).version as number
                            : 0;

                        if (existingItem) {
                            // Item exists: merge fields using LWW if enabled
                            for (const fieldName in partialItem) {
                                if (fieldName === 'id' || fieldName === 'version') continue; // Skip id and version

                                const field = collectionFields?.[fieldName];
                                // Skip local fields - they're client-side only
                                if (field?.fieldType === 'local') continue;

                                const incomingValue = (partialItem as Record<string, unknown>)[fieldName];

                                // For fields, use incoming version (object version)
                                const fieldVersion = incomingVersion;

                                // Regular field - wrap it
                                const existingField = existingItem[fieldName] as FieldValue<unknown> | undefined;

                                if (existingField && versioned && fieldVersion > 0) {
                                    // LWW: compare versions, keep most recent
                                    if (fieldVersion > existingField.version) {
                                        existingItem[fieldName] = {
                                            value: incomingValue,
                                            version: fieldVersion,
                                        };
                                    }
                                } else {
                                    // No existing field or no tracking - just set it
                                    existingItem[fieldName] = {
                                        value: incomingValue,
                                        version: fieldVersion,
                                    };
                                }
                            }

                            // Update object version if tracking enabled and new version provided
                            if (versioned && incomingVersion > 0) {
                                const currentVersion = existingItem.version as number || 0;
                                if (incomingVersion > currentVersion) {
                                    existingItem.version = incomingVersion;
                                }
                            }
                        } else {
                            // Item doesn't exist: create if complete
                            if (isComplete(partialItem as Record<string, unknown>, collectionName)) {
                                const newItem: Record<string, unknown> = {
                                    id: itemId, // id is not wrapped
                                };

                                // Add version field if versioning enabled
                                if (versioned) {
                                    newItem.version = incomingVersion;
                                }

                                // Wrap all fields (except id and version)
                                for (const fieldName in partialItem) {
                                    if (fieldName === 'id' || fieldName === 'version') continue;

                                    const field = collectionFields?.[fieldName];
                                    if (field?.fieldType === 'local') {
                                        // Initialize local field with default value (wrapped)
                                        newItem[fieldName] = {
                                            value: field.defaultValue,
                                            version: 0, // Local fields always have version = 0
                                        };
                                    } else {
                                        // Wrap regular field with object version
                                        newItem[fieldName] = {
                                            value: (partialItem as Record<string, unknown>)[fieldName],
                                            version: incomingVersion,
                                        };
                                    }
                                }

                                // Add local fields that weren't in the partial item
                                for (const fieldName in collectionFields) {
                                    const field = collectionFields[fieldName];
                                    if (field.fieldType === 'local' && !(fieldName in partialItem)) {
                                        newItem[fieldName] = {
                                            value: field.defaultValue,
                                            version: 0,
                                        };
                                    }
                                }

                                (collection as Record<string, unknown>)[itemId] = newItem;
                            }
                            // Otherwise ignore incomplete items
                        }
                    }
                }
            }) as ServerSnapshot<T>;

            // Rebase client state with new server snapshot
            rebaseState();
        },
    };
}