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
 * - Waiting for server confirmation
 * - Will be rebased if server state changes
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
 *
 * // Type narrowing based on mutation name
 * for (const mutation of engine.pendingMutations) {
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
     * Read-only array to prevent external modification
     */
    readonly pendingMutations: ReadonlyArray<PendingMutation<T>>;

    /**
     * Apply a mutation locally
     * Creates a mutation ID and timestamp, adds to pending list, and rebases state
     */
    mutate<M extends InferMutations<Schema<T>>>(
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
    const pendingMutations: PendingMutation<T>[] = [];
    const mutators: MutatorRegistry<T> = {} as MutatorRegistry<T>;

    /**
     * Rebase state by applying all pending mutations to server state
     */
    const rebaseState = (): void => {
        state = pendingMutations.reduce(
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
            // Return readonly copy to prevent external modification
            return pendingMutations as ReadonlyArray<PendingMutation<T>>;
        },

        mutate(name, input) {
            // Create mutation metadata
            const mutation: PendingMutation<T> = {
                id: createId(),
                timestamp: Date.now(),
                name: name as InferMutations<Schema<T>>,
                input,
            };

            // Add to pending mutations
            pendingMutations.push(mutation);

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
            const originalLength = pendingMutations.length;
            let i = pendingMutations.length;
            while (i--) {
                if (idsSet.has(pendingMutations[i].id)) {
                    pendingMutations.splice(i, 1);
                }
            }

            // Only rebase if we actually removed something
            if (pendingMutations.length !== originalLength) {
                rebaseState();
            }
        },

        rebase(partialServerUpdate) {
            // Helper to check if an item has all required fields defined
            const isComplete = (item: Record<string, unknown>, collectionName: string): boolean => {
                const collectionFields = schema.collection(collectionName as keyof T['types']);
                if (!collectionFields) return false;

                // Check id and createdAt
                if (item.id === undefined || item.createdAt === undefined) {
                    return false;
                }

                // Check all schema-defined fields
                for (const fieldName in collectionFields) {
                    if (item[fieldName] === undefined) {
                        return false;
                    }
                }

                return true;
            };

            // Merge partial server update into current server state
            serverState = produce(serverState, draft => {
                const draftState = draft as SyncState<T>;

                for (const collectionName in partialServerUpdate) {
                    const collectionKey = collectionName as keyof T['types'];
                    const partialItems = partialServerUpdate[collectionKey];
                    if (!partialItems) continue;

                    const collection = draftState[collectionKey];

                    for (const partialItem of partialItems) {
                        const itemId = partialItem.id;
                        const existingItem = collection[itemId];

                        if (existingItem) {
                            // Item exists: patch/merge fields
                            Object.assign(existingItem, partialItem);
                        } else {
                            // Item doesn't exist: only create if complete
                            if (isComplete(partialItem as Record<string, unknown>, collectionName)) {
                                // Use type assertion to bypass complex type inference
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