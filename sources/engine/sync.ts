import { FullSchemaDefinition, InferItemState, InferMutationInput, InferMutations, Schema } from "./schema";
import { produce } from 'immer';
import { createId } from '@paralleldrive/cuid2';

/**
 * State type for the sync engine
 * Maps collection names to records of items indexed by ID
 */
export type SyncState<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]: Record<string, InferItemState<Schema<T>, K>>
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
 * Partial server update - collections contain arrays of partial items
 * Each item must have an id, but other fields are optional
 */
export type PartialServerUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: Array<
        Partial<InferItemState<Schema<T>, K>> & { id: string }
    >
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
export function sync<T extends FullSchemaDefinition>(schema: Schema<T>): SyncEngine<T> {

    // Create empty initial state
    const createEmptyState = (): SyncState<T> => {
        const emptyState = {} as SyncState<T>;
        for (let collection of Object.keys(schema._schema.types)) {
            emptyState[collection as keyof T['types']] = {};
        }
        return emptyState;
    };

    // Internal state
    let serverState: SyncState<T> = createEmptyState();
    let state: SyncState<T> = createEmptyState();
    // All mutations (both pending and local) in order
    const allPendingMutations: PendingMutation<T>[] = [];
    const mutators: MutatorRegistry<T> = {} as MutatorRegistry<T>;

    /**
     * Rebase state by applying ALL mutations (including local) to server state
     */
    const rebaseState = (): void => {
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
            serverState
        );
    };

    return {
        get state() {
            return state;
        },

        get serverState() {
            return serverState;
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

            // Helper to initialize local fields with default values
            const initializeLocalFields = (item: Record<string, unknown>, collectionName: string): void => {
                const collectionFields = schema.collection(collectionName as keyof T['types']);
                if (!collectionFields) return;

                for (const fieldName in collectionFields) {
                    const field = collectionFields[fieldName];
                    if (field.fieldType === 'local') {
                        // Initialize local field with default value
                        item[fieldName] = field.defaultValue;
                    }
                }
            };

            // Merge partial server update into current server state
            serverState = produce(serverState, draft => {
                const draftState = draft as SyncState<T>;

                for (const collectionName in partialServerUpdate) {
                    const collectionKey = collectionName as keyof T['types'];
                    const partialItems = partialServerUpdate[collectionKey];
                    if (!partialItems) continue;

                    const collection = draftState[collectionKey];
                    const collectionFields = schema.collection(collectionKey);

                    for (const partialItem of partialItems) {
                        const itemId = partialItem.id;
                        const existingItem = collection[itemId];

                        if (existingItem) {
                            // Item exists: patch/merge fields (but SKIP local fields)
                            for (const key in partialItem) {
                                const field = collectionFields?.[key];
                                // Skip local fields - they're client-side only
                                if (field?.fieldType === 'local') continue;
                                // Update all other fields
                                (existingItem as Record<string, unknown>)[key] = (partialItem as Record<string, unknown>)[key];
                            }
                        } else {
                            // Item doesn't exist: only create if complete
                            if (isComplete(partialItem as Record<string, unknown>, collectionName)) {
                                // Initialize local fields with defaults
                                initializeLocalFields(partialItem as Record<string, unknown>, collectionName);
                                // Create the item
                                (collection as Record<string, unknown>)[itemId] = partialItem;
                            }
                            // Otherwise ignore incomplete items
                        }
                    }
                }
            }) as SyncState<T>;

            // Rebase state with new server state
            rebaseState();
        },
    };
}