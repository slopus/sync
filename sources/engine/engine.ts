import { FullSchemaDefinition, InferItemState, InferMutationInput, InferMutations, InferServerItemState, Schema, CollectionType, ObjectType, ExtractSchemaDefinition, InferObjectState, InferServerObjectState, CollectionSchema, InferFieldValue, ServerFieldsOnly, LocalFieldsOnly, ServerAndLocalFields, ExtractFields, InitialObjectValuesParam } from "./schema";
import { produce } from 'immer';
import { createId } from '@paralleldrive/cuid2';
import { FieldValue, PersistedState } from "./types";

/**
 * Helper type to check if a collection or object has versioning enabled
 */
type HasVersionTracking<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> =
    ExtractSchemaDefinition<TSchema>[TCollection] extends CollectionType<any> | ObjectType<any>
        ? ExtractSchemaDefinition<TSchema>[TCollection] extends { versioned: true }
            ? true
            : false
        : false;

/**
 * Helper to determine state structure based on type (collection vs singleton)
 */
type InferStateForType<T extends FullSchemaDefinition, K extends keyof T['types']> =
    T['types'][K] extends ObjectType
        ? InferObjectState<Schema<T>, K>  // Direct object (no Record wrapper)
        : Record<string, InferItemState<Schema<T>, K>>;  // Collection (key-indexed)

/**
 * Helper to determine server state structure based on type (collection vs singleton)
 */
type InferServerStateForType<T extends FullSchemaDefinition, K extends keyof T['types']> =
    T['types'][K] extends ObjectType
        ? InferServerObjectState<Schema<T>, K>  // Direct object (no Record wrapper)
        : Record<string, InferServerItemState<Schema<T>, K>>;  // Collection (key-indexed)

/**
 * State type for the sync engine (client-side representation)
 * - Collections: Record of items indexed by ID
 * - Singleton objects: Direct object access (no key)
 * All fields are unwrapped (plain values)
 */
export type SyncState<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]: InferStateForType<T, K>
};

/**
 * Server snapshot type (server-side internal representation)
 * - Collections: Record of items with wrapped fields and per-item versions
 * - Singleton objects: Direct object with wrapped fields and version
 * Contains wrapped field values with versions for LWW conflict resolution
 */
export type ServerSnapshot<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]: InferServerStateForType<T, K>
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
 * Initialization parameter for syncEngine()
 * Supports two modes:
 * - 'new': Start with fresh state and provided initial object values (objects is optional if no singletons)
 * - 'restore': Restore from previously persisted state
 */
export type InitParam<T extends FullSchemaDefinition> =
    | (InitialObjectValuesParam<T> extends Record<string, never>
        ? { from: 'new'; objects?: InitialObjectValuesParam<T> }
        : { from: 'new'; objects: InitialObjectValuesParam<T> })
    | { from: 'restore'; data: string };

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
 * Generate partial update fields - all fields optional
 */
type PartialUpdateFields<TFields extends CollectionSchema> = {
    [K in keyof TFields]?: InferFieldValue<TFields[K]>;
};

/**
 * Generate full update fields - all fields required
 */
type FullUpdateFields<TFields extends CollectionSchema> = {
    [K in keyof TFields]: InferFieldValue<TFields[K]>;
};

/**
 * Partial update for a collection item
 */
type PartialUpdateItem<T extends FullSchemaDefinition, TCollection extends keyof T['types'], TFields extends CollectionSchema> =
    HasVersionTracking<Schema<T>, TCollection> extends true
        ? { id: string; $version: number } & PartialUpdateFields<TFields>
        : { id: string; $version?: never } & PartialUpdateFields<TFields>;

/**
 * Full update for a collection item
 */
type FullUpdateItem<T extends FullSchemaDefinition, TCollection extends keyof T['types'], TFields extends CollectionSchema> =
    HasVersionTracking<Schema<T>, TCollection> extends true
        ? { id: string; $version: number } & FullUpdateFields<TFields>
        : { id: string; $version?: never } & FullUpdateFields<TFields>;

/**
 * Partial update for a singleton object
 */
type PartialUpdateObject<T extends FullSchemaDefinition, TObject extends keyof T['types'], TFields extends CollectionSchema> =
    HasVersionTracking<Schema<T>, TObject> extends true
        ? { $version: number } & PartialUpdateFields<TFields>
        : { $version?: never } & PartialUpdateFields<TFields>;

/**
 * Full update for a singleton object
 */
type FullUpdateObject<T extends FullSchemaDefinition, TObject extends keyof T['types'], TFields extends CollectionSchema> =
    HasVersionTracking<Schema<T>, TObject> extends true
        ? { $version: number } & FullUpdateFields<TFields>
        : { $version?: never } & FullUpdateFields<TFields>;

/**
 * Partial update with mixed fields (server + local)
 * - Collections: arrays of partial items
 * - Singletons: single object
 * - Fields: All fields (server + local) are optional
 */
export type PartialUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? PartialUpdateObject<T, K, ServerAndLocalFields<TFields>>
        : Array<PartialUpdateItem<T, K, ServerAndLocalFields<ExtractFields<T['types'][K]>>>>
};

/**
 * Partial update with server fields only
 * - Collections: arrays of partial items
 * - Singletons: single object
 * - Fields: Only server fields (excludes local fields)
 */
export type PartialServerUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? PartialUpdateObject<T, K, ServerFieldsOnly<TFields>>
        : Array<PartialUpdateItem<T, K, ServerFieldsOnly<ExtractFields<T['types'][K]>>>>
};

/**
 * Partial update with local fields only
 * - Collections: arrays of partial items
 * - Singletons: single object
 * - Fields: Only local fields (excludes server fields)
 */
export type PartialLocalUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? PartialUpdateObject<T, K, LocalFieldsOnly<TFields>>
        : Array<PartialUpdateItem<T, K, LocalFieldsOnly<ExtractFields<T['types'][K]>>>>
};

/**
 * Full update with mixed fields (server + local)
 * - Collections: arrays of complete items
 * - Singletons: single complete object
 * - Fields: All fields (server + local) are required
 */
export type FullUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? FullUpdateObject<T, K, ServerAndLocalFields<TFields>>
        : Array<FullUpdateItem<T, K, ServerAndLocalFields<ExtractFields<T['types'][K]>>>>
};

/**
 * Full update with server fields only
 * - Collections: arrays of complete items
 * - Singletons: single complete object
 * - Fields: Only server fields are required (excludes local fields)
 */
export type FullServerUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? FullUpdateObject<T, K, ServerFieldsOnly<TFields>>
        : Array<FullUpdateItem<T, K, ServerFieldsOnly<ExtractFields<T['types'][K]>>>>
};

/**
 * Full update with local fields only
 * - Collections: arrays of complete items
 * - Singletons: single complete object
 * - Fields: Only local fields are required (excludes server fields)
 */
export type FullLocalUpdate<T extends FullSchemaDefinition> = {
    [K in keyof T['types']]?: T['types'][K] extends ObjectType<infer TFields>
        ? FullUpdateObject<T, K, LocalFieldsOnly<TFields>>
        : Array<FullUpdateItem<T, K, LocalFieldsOnly<ExtractFields<T['types'][K]>>>>
};

/**
 * Options for rebase method to control which fields are updated
 */
export interface RebaseOptions {
    /**
     * Allow updating regular (server-synced) fields
     * @default true
     */
    allowServerFields?: boolean;

    /**
     * Allow updating local (client-only) fields
     * @default false
     */
    allowLocalFields?: boolean;

    /**
     * Skip full state rebase (don't reapply pending mutations)
     * When true, only updates server snapshot without recomputing client state
     * @default false
     */
    direct?: boolean;
}

/**
 * Options for mutate method to control how mutations are applied
 */
export interface MutateOptions {
    /**
     * Apply mutation directly to client state without queueing
     * When true, the mutation is applied immediately to state but NOT added to pending queue
     * This is useful for local-only state changes that don't need server confirmation
     * @default false
     */
    direct?: boolean;
}

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
     * This mutation will be sent to the server
     *
     * The mutation handler must be defined in the schema.
     * If no handler is found, an error will be thrown.
     *
     * @param name - Name of the mutation to apply
     * @param input - Input data for the mutation
     * @param options - Optional mutation configuration
     * @param options.direct - If true, apply mutation directly without queueing (default: false)
     */
    mutate<M extends InferMutations<Schema<T>>>(
        name: M,
        input: InferMutationInput<Schema<T>, M>,
        options?: MutateOptions
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
     * - Automatically rebases pending mutations after update (unless direct=true)
     *
     * @param partialUpdate - Partial data to merge into server snapshot (can include server and/or local fields)
     * @param options - Optional rebase configuration
     * @param options.allowServerFields - Allow updating regular fields (default: true)
     * @param options.allowLocalFields - Allow updating local fields (default: false)
     * @param options.direct - Skip full state rebase (default: false)
     */
    rebase(partialUpdate: PartialUpdate<T>, options?: RebaseOptions): void;

    /**
     * Serialize current engine state for persistence
     * Returns stringified server snapshot + pending mutations
     *
     * The returned string can be stored and later used with
     * syncEngine({ from: 'restore', data: persistedData })
     * to restore the exact state of the engine
     *
     * @returns Stringified persisted state
     */
    persist(): string;
}

/**
 * Create a sync engine for the given schema
 *
 * Supports two initialization modes:
 * - New: `{ from: 'new', objects: {...} }` - Start with fresh state (objects optional if no singletons)
 * - Restore: `{ from: 'restore', data: persistedData }` - Restore from persisted state
 */
export function syncEngine<T extends FullSchemaDefinition>(
    schema: Schema<T>,
    init: InitParam<T>
): SyncEngine<T> {

    // Create initial state (client representation) with provided object values
    const createEmptyState = (initialValues: InitialObjectValuesParam<T>): SyncState<T> => {
        const emptyState = {} as SyncState<T>;
        for (let name of Object.keys(schema._schema.types)) {
            const typeKey = name as keyof T['types'];
            const typeDef = (schema._schema.types as Record<string, CollectionType | ObjectType>)[name];

            if (typeDef._tag === 'ObjectType') {
                // Singleton: initialize with provided values (plain)
                const objectData = (initialValues as Record<string, Record<string, unknown>>)[name];
                const plainObject: Record<string, unknown> = { ...objectData };

                // Add local fields with defaults
                for (const fieldName in typeDef.fields) {
                    const field = typeDef.fields[fieldName];
                    if (field.fieldType === 'local') {
                        plainObject[fieldName] = field.defaultValue;
                    }
                }

                emptyState[typeKey] = plainObject as InferStateForType<T, typeof typeKey>;
            } else {
                // Collection: initialize as empty Record
                emptyState[typeKey] = {} as InferStateForType<T, typeof typeKey>;
            }
        }
        return emptyState;
    };

    // Create initial server snapshot (server representation) with provided object values
    const createEmptySnapshot = (initialValues: InitialObjectValuesParam<T>): ServerSnapshot<T> => {
        const emptySnapshot = {} as ServerSnapshot<T>;
        for (let name of Object.keys(schema._schema.types)) {
            const typeKey = name as keyof T['types'];
            const typeDef = (schema._schema.types as Record<string, CollectionType | ObjectType>)[name];

            if (typeDef._tag === 'ObjectType') {
                // Singleton: initialize with provided values wrapped as FieldValue
                const objectData = (initialValues as Record<string, Record<string, unknown>>)[name];
                const wrappedObject: Record<string, unknown> = {};

                // Wrap each field with version: 0
                for (const fieldName in typeDef.fields) {
                    const field = typeDef.fields[fieldName];

                    if (field.fieldType === 'local') {
                        // Local fields use default value
                        wrappedObject[fieldName] = {
                            value: field.defaultValue,
                            version: 0,
                        };
                    } else {
                        // Server fields use provided value
                        if (fieldName in objectData) {
                            wrappedObject[fieldName] = {
                                value: objectData[fieldName],
                                version: 0,
                            };
                        } else {
                            throw new Error(`Missing initial value for field '${fieldName}' in object '${name}'`);
                        }
                    }
                }

                // Add version if tracking enabled
                if (typeDef.versioned) {
                    wrappedObject.$version = 0;
                }

                emptySnapshot[typeKey] = wrappedObject as InferServerStateForType<T, typeof typeKey>;
            } else {
                // Collection: initialize as empty Record
                (emptySnapshot as Record<string, Record<string, unknown>>)[name] = {};
            }
        }
        return emptySnapshot;
    };

    /**
     * Unwrap server snapshot to client state
     * Converts FieldValue<T> to plain T for all fields except id and version
     * Handles both collections (key-indexed) and singletons (direct object)
     */
    const unwrapSnapshot = (snapshot: ServerSnapshot<T>): SyncState<T> => {
        const clientState = {} as SyncState<T>;

        for (const name in snapshot) {
            const typeKey = name as keyof T['types'];
            const typeDef = (schema._schema.types as Record<string, CollectionType | ObjectType>)[name];

            if (typeDef._tag === 'ObjectType') {
                // Singleton: unwrap directly (no iteration over items)
                const serverObject = snapshot[typeKey] as Record<string, unknown>;
                const clientObject: Record<string, unknown> = {};

                // Unwrap all fields, preserve $version if present
                for (const fieldName in serverObject) {
                    if (fieldName === '$version') {
                        // $version is not wrapped, copy it directly
                        clientObject[fieldName] = serverObject[fieldName];
                    } else {
                        const fieldValue = serverObject[fieldName] as FieldValue<unknown>;
                        clientObject[fieldName] = fieldValue.value;
                    }
                }

                clientState[typeKey] = clientObject as InferStateForType<T, typeof typeKey>;
            } else {
                // Collection: unwrap each item
                const serverItems = snapshot[typeKey] as Record<string, unknown>;
                const clientItems: Record<string, unknown> = {};

                for (const itemId in serverItems) {
                    const serverItem = serverItems[itemId] as Record<string, unknown>;
                    const clientItem: Record<string, unknown> = {
                        id: serverItem.id, // id is not wrapped
                    };

                    // Unwrap all other fields (skip id, but preserve $version)
                    for (const fieldName in serverItem) {
                        if (fieldName === 'id') continue; // id is already added

                        if (fieldName === '$version') {
                            // $version is not wrapped, copy it directly
                            clientItem[fieldName] = serverItem[fieldName];
                        } else {
                            // Regular fields are wrapped
                            const fieldValue = serverItem[fieldName] as FieldValue<unknown>;
                            clientItem[fieldName] = fieldValue.value;
                        }
                    }

                    clientItems[itemId] = clientItem;
                }

                clientState[typeKey] = clientItems as InferStateForType<T, typeof typeKey>;
            }
        }

        return clientState;
    };

    // Internal state - initialized based on mode
    let serverSnapshot: ServerSnapshot<T>;
    let state: SyncState<T>;
    const pendingMutations: PendingMutation<T>[] = [];
    const mutators: MutatorRegistry<T> = {} as MutatorRegistry<T>;

    // Auto-register mutation handlers from schema
    if (schema._schema.mutations) {
        for (const mutationName in schema._schema.mutations) {
            const descriptor = schema._schema.mutations[mutationName];
            if (!descriptor || !descriptor.handler) {
                throw new Error(`Mutation '${mutationName}' is missing a handler. All mutations must have handlers defined in the schema.`);
            }
            mutators[mutationName as InferMutations<Schema<T>>] = descriptor.handler as Mutator<T>;
        }
    }

    // Initialize based on mode
    if (init.from === 'new') {
        // New mode: create fresh state with provided initial values
        const objects = init.objects ?? ({} as InitialObjectValuesParam<T>);
        serverSnapshot = createEmptySnapshot(objects);
        state = createEmptyState(objects);
    } else {
        // Restore mode: deserialize persisted state
        const persisted = JSON.parse(init.data) as PersistedState<ServerSnapshot<T>>;
        serverSnapshot = persisted.serverSnapshot;

        // Restore pending mutations
        pendingMutations.push(...(persisted.pendingMutations as PendingMutation<T>[]));

        // Initialize state with unwrapped snapshot
        // Pending mutations will be reapplied after rebaseState is defined
        state = unwrapSnapshot(serverSnapshot);
    }

    /**
     * Rebase state by applying all pending mutations to unwrapped server state
     */
    const rebaseState = (): void => {
        // Start with unwrapped server snapshot
        const baseState = unwrapSnapshot(serverSnapshot);

        // Apply all pending mutations on top
        state = pendingMutations.reduce(
            (currentState, mutation) => {
                const mutator = mutators[mutation.name];
                if (!mutator) {
                    throw new Error(`No handler found for mutation '${String(mutation.name)}'. This should not happen if the schema was validated correctly.`);
                }
                return produce(currentState, draft => {
                    mutator(draft as SyncState<T>, mutation.input);
                }) as SyncState<T>;
            },
            baseState
        );
    };

    // If restoring with pending mutations, rebase now
    if (init.from === 'restore' && pendingMutations.length > 0) {
        rebaseState();
    }

    /**
     * Apply partial update to a state representation (server snapshot or client state)
     * @param target - State to update (server snapshot with FieldValue wrappers, or client state with plain values)
     * @param partialUpdate - Incoming changes to apply
     * @param wrapped - If true, wrap values in FieldValue and apply LWW (for server snapshot). If false, use plain values (for client state)
     * @param allowServerFields - Whether to update server fields
     * @param allowLocalFields - Whether to update local fields
     */
    const applyPartialUpdate = <TTarget extends ServerSnapshot<T> | SyncState<T>>(
        target: TTarget,
        partialUpdate: PartialServerUpdate<T>,
        wrapped: boolean,
        allowServerFields: boolean,
        allowLocalFields: boolean
    ): TTarget => {
        // Helper to check if an item has all required fields defined
        const isComplete = (item: Record<string, unknown>, collectionName: string): boolean => {
            const collectionFields = schema.collection(collectionName as keyof T['types']);
            if (!collectionFields) return false;

            if (item.id === undefined) return false;

            for (const fieldName in collectionFields) {
                const field = collectionFields[fieldName];
                if (field.fieldType === 'local') continue;
                if (item[fieldName] === undefined) return false;
            }

            return true;
        };

        return produce(target, draft => {
            for (const name in partialUpdate) {
                const typeKey = name as keyof T['types'];
                const partialData = partialUpdate[typeKey];
                if (!partialData) continue;

                const typeDef = (schema._schema.types as Record<string, CollectionType | ObjectType>)[name];
                const typeFields = schema.collection(typeKey);
                const versioned = typeDef.versioned;

                if (typeDef._tag === 'ObjectType') {
                    // Singleton object
                    const partialObject = partialData as Record<string, unknown>;
                    const singletonObject = (draft as Record<string, Record<string, unknown>>)[name];

                    const incomingVersion = versioned && '$version' in partialObject
                        ? partialObject.$version as number
                        : 0;

                    const exists = Object.keys(singletonObject).length > 0;

                    if (exists) {
                        // Patch existing singleton
                        for (const fieldName in partialObject) {
                            if (fieldName === '$version') continue;

                            const field = typeFields?.[fieldName];
                            const isLocal = field?.fieldType === 'local';

                            if (isLocal && !allowLocalFields) continue;
                            if (!isLocal && !allowServerFields) continue;

                            if (wrapped) {
                                // Server snapshot: wrapped values with LWW
                                const incomingValue = partialObject[fieldName];
                                const fieldVersion = incomingVersion;
                                const existingField = singletonObject[fieldName] as FieldValue<unknown> | undefined;

                                if (existingField && versioned && fieldVersion > 0) {
                                    if (fieldVersion > existingField.version) {
                                        singletonObject[fieldName] = {
                                            value: incomingValue,
                                            version: fieldVersion,
                                        };
                                    }
                                } else {
                                    singletonObject[fieldName] = {
                                        value: incomingValue,
                                        version: fieldVersion,
                                    };
                                }
                            } else {
                                // Client state: plain values
                                singletonObject[fieldName] = partialObject[fieldName];
                            }
                        }

                        if (wrapped && versioned && incomingVersion > 0) {
                            const currentVersion = singletonObject.$version as number || 0;
                            if (incomingVersion > currentVersion) {
                                singletonObject.$version = incomingVersion;
                            }
                        }
                    } else {
                        // Create new singleton
                        if (versioned) {
                            singletonObject.$version = incomingVersion;
                        }

                        for (const fieldName in partialObject) {
                            if (fieldName === '$version') continue;

                            const field = typeFields?.[fieldName];
                            const isLocal = field?.fieldType === 'local';

                            if (isLocal && !allowLocalFields) {
                                singletonObject[fieldName] = {
                                    value: field.defaultValue,
                                    version: 0,
                                };
                            } else if (!isLocal && !allowServerFields) {
                                continue;
                            } else if (isLocal && allowLocalFields) {
                                singletonObject[fieldName] = {
                                    value: partialObject[fieldName],
                                    version: 0,
                                };
                            } else {
                                singletonObject[fieldName] = {
                                    value: partialObject[fieldName],
                                    version: incomingVersion,
                                };
                            }
                        }

                        // Add local fields that weren't in the partial object
                        for (const fieldName in typeFields) {
                            const field = typeFields[fieldName];
                            if (field.fieldType === 'local' && !(fieldName in partialObject)) {
                                singletonObject[fieldName] = {
                                    value: field.defaultValue,
                                    version: 0,
                                };
                            }
                        }
                    }
                } else {
                    // Collection
                    const partialItems = partialData as Array<Record<string, unknown>>;
                    const collection = (draft as Record<string, Record<string, unknown>>)[name];

                    for (const partialItem of partialItems) {
                        const itemId = partialItem.id as string;
                        const existingItem = collection[itemId] as Record<string, unknown> | undefined;

                        const incomingVersion = versioned && '$version' in partialItem
                            ? partialItem.$version as number
                            : 0;

                        if (existingItem) {
                            // Patch existing item
                            for (const fieldName in partialItem) {
                                if (fieldName === 'id' || fieldName === '$version') continue;

                                const field = typeFields?.[fieldName];
                                const isLocal = field?.fieldType === 'local';

                                if (isLocal && !allowLocalFields) continue;
                                if (!isLocal && !allowServerFields) continue;

                                if (wrapped) {
                                    // Server snapshot: wrapped values with LWW
                                    const incomingValue = partialItem[fieldName];
                                    const fieldVersion = incomingVersion;
                                    const existingField = existingItem[fieldName] as FieldValue<unknown> | undefined;

                                    if (existingField && versioned && fieldVersion > 0) {
                                        if (fieldVersion > existingField.version) {
                                            existingItem[fieldName] = {
                                                value: incomingValue,
                                                version: fieldVersion,
                                            };
                                        }
                                    } else {
                                        existingItem[fieldName] = {
                                            value: incomingValue,
                                            version: fieldVersion,
                                        };
                                    }
                                } else {
                                    // Client state: plain values
                                    existingItem[fieldName] = partialItem[fieldName];
                                }
                            }

                            if (wrapped && versioned && incomingVersion > 0) {
                                const currentVersion = existingItem.$version as number || 0;
                                if (incomingVersion > currentVersion) {
                                    existingItem.$version = incomingVersion;
                                }
                            }
                        } else if (isComplete(partialItem, name)) {
                            // Create new item
                            const newItem: Record<string, unknown> = {
                                id: itemId,
                            };

                            if (versioned) {
                                newItem.$version = incomingVersion;
                            }

                            for (const fieldName in partialItem) {
                                if (fieldName === 'id' || fieldName === '$version') continue;

                                const field = typeFields?.[fieldName];
                                const isLocal = field?.fieldType === 'local';

                                if (isLocal && !allowLocalFields) {
                                    newItem[fieldName] = {
                                        value: field.defaultValue,
                                        version: 0,
                                    };
                                } else if (!isLocal && !allowServerFields) {
                                    continue;
                                } else if (isLocal && allowLocalFields) {
                                    newItem[fieldName] = {
                                        value: partialItem[fieldName],
                                        version: 0,
                                    };
                                } else {
                                    newItem[fieldName] = {
                                        value: partialItem[fieldName],
                                        version: incomingVersion,
                                    };
                                }
                            }

                            // Add local fields that weren't in the partial item
                            for (const fieldName in typeFields) {
                                const field = typeFields[fieldName];
                                if (field.fieldType === 'local' && !(fieldName in partialItem)) {
                                    newItem[fieldName] = {
                                        value: field.defaultValue,
                                        version: 0,
                                    };
                                }
                            }

                            collection[itemId] = newItem;
                        }
                    }
                }
            }
        }) as TTarget;
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
            // Return readonly copy of pending mutations
            return pendingMutations as ReadonlyArray<PendingMutation<T>>;
        },

        mutate(name, input, options) {
            // Get the mutator handler
            const mutator = mutators[name];
            if (!mutator) {
                throw new Error(`No handler found for mutation '${String(name)}'. This should not happen if the schema was validated correctly.`);
            }

            // Check if direct mode
            const direct = options?.direct ?? false;

            if (direct) {
                // Direct mode: apply mutation immediately without queueing
                state = produce(state, draft => {
                    mutator(draft as SyncState<T>, input);
                }) as SyncState<T>;
            } else {
                // Normal mode: add to pending queue and rebase
                // Create mutation metadata
                const mutation: PendingMutation<T> = {
                    id: createId(),
                    timestamp: Date.now(),
                    name: name as InferMutations<Schema<T>>,
                    input,
                };

                // Add to mutations list
                pendingMutations.push(mutation);

                // Rebase state
                rebaseState();
            }
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

        rebase(partialUpdate, options) {
            // Destructure options with defaults
            const {
                allowServerFields = true,
                allowLocalFields = false,
                direct = false,
            } = options ?? {};

            // Update server snapshot (wrapped values with LWW)
            serverSnapshot = applyPartialUpdate(
                serverSnapshot,
                partialUpdate,
                true,  // wrapped
                allowServerFields,
                allowLocalFields
            );

            // Update client state based on mode
            if (!direct) {
                // Normal mode: full rebase (unwrap + reapply mutations)
                rebaseState();
            } else {
                // Direct mode: patch client state directly (plain values, no mutation reapplication)
                state = applyPartialUpdate(
                    state,
                    partialUpdate,
                    false, // unwrapped (plain values)
                    allowServerFields,
                    allowLocalFields
                );
            }
        },

        persist() {
            // Serialize server snapshot and pending mutations
            const persisted: PersistedState<ServerSnapshot<T>> = {
                serverSnapshot,
                pendingMutations: pendingMutations as unknown[],
            };
            return JSON.stringify(persisted);
        },
    };
}