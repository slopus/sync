/**
 * Schema DSL for defining collection types
 *
 * Provides a declarative way to define schemas for collections with:
 * - Mutable fields (with version tracking)
 * - Immutable fields (plain values)
 * - Automatic type inference for Create, Update, Item, and Denormalized representations
 */

import type { FieldValue, Version } from './types';

// ============================================================================
// Field Descriptors
// ============================================================================

/**
 * Field type discriminator
 */
export type FieldType = 'field' | 'reference' | 'local';

/**
 * Regular field descriptor
 * All fields track versions for conflict resolution when versioned is enabled
 */
export interface RegularFieldDescriptor<T = unknown> {
    readonly fieldType: 'field';
    // Phantom type parameter for TypeScript type inference
    readonly __type?: T;
}

/**
 * Local field descriptor
 * Local fields are client-side only and track when they were last changed
 * - Always initialized with a default value
 * - Can be mutated locally (tracked with version)
 * - NOT synced from server (server updates ignore local fields)
 * - Useful for UI state like selection, expansion, etc.
 */
export interface LocalFieldDescriptor<T = unknown> {
    readonly fieldType: 'local';
    readonly defaultValue: T;
    // Phantom type parameter for TypeScript type inference
    readonly __type?: T;
}

/**
 * Reference field descriptor
 * References point to items in other collections
 * References are immutable by default (like foreign keys)
 */
export interface ReferenceFieldDescriptor<TCollection extends string = string, TNullable extends boolean = false> {
    readonly fieldType: 'reference';
    readonly referenceCollection: TCollection;
    readonly nullable: TNullable;
    // Phantom type parameter for the referenced collection
    readonly __collection?: TCollection;
}

/**
 * Field descriptor - strict discriminated union of all valid field descriptor types
 * This ensures only valid field descriptors can be used in schemas
 */
export type FieldDescriptor<T = unknown> =
    | RegularFieldDescriptor<T>
    | LocalFieldDescriptor<T>
    | ReferenceFieldDescriptor<any, any>;

/**
 * Create a regular field descriptor
 * All fields participate in version tracking when trackUpdatedAt is enabled
 *
 * @example
 * const schema = defineSchema({
 *   types: {
 *     todos: type({
 *       fields: {
 *         title: field<string>(),
 *         completed: field<boolean>(),
 *         priority: field<number>(),
 *       }
 *     })
 *   }
 * });
 */
export function field<T>(): RegularFieldDescriptor<T> {
    return { fieldType: 'field' } as RegularFieldDescriptor<T>;
}

/**
 * Create a local field descriptor
 * Local fields are client-side only and not synced from server
 *
 * Local fields:
 * - Always have a default value
 * - Track changes locally (with version timestamp)
 * - Are NOT updated from server snapshots (always use default value)
 * - Perfect for UI state (selection, expansion, filters, etc.)
 *
 * @param defaultValue - The default value to use when creating new items
 *
 * @example
 * const schema = defineSchema({
 *   todos: type({
 *     fields: {
 *       title: mutable<string>(),
 *       isExpanded: local(false),     // UI state: always false for new items
 *       isSelected: local(false),     // UI state: always false for new items
 *     }
 *   })
 * });
 */
export function local<T>(defaultValue: T): LocalFieldDescriptor<T> {
    return { fieldType: 'local', defaultValue } as LocalFieldDescriptor<T>;
}

/**
 * Create a reference field descriptor
 * References point to items in other collections by their ID
 *
 * @param collection - Name of the collection being referenced
 * @param options - Configuration options
 * @param options.nullable - Whether the reference can be null (default: false)
 *
 * @example
 * const schema = defineSchema({
 *   users: type({
 *     fields: {
 *       name: mutable<string>(),
 *     }
 *   }),
 *   todos: type({
 *     fields: {
 *       title: mutable<string>(),
 *       assignedTo: reference('users'), // Required reference
 *       reviewer: reference('users', { nullable: true }), // Optional reference
 *     }
 *   })
 * });
 */
export function reference<TCollection extends string, TNullable extends boolean = false>(
    collection: TCollection,
    options?: { nullable?: TNullable }
): ReferenceFieldDescriptor<TCollection, TNullable> {
    return {
        fieldType: 'reference',
        referenceCollection: collection,
        nullable: options?.nullable ?? false as TNullable,
    } as ReferenceFieldDescriptor<TCollection, TNullable>;
}

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Reserved field names that cannot be used in schema definitions
 */
type ReservedFieldNames = 'id';

/**
 * Helper type to check if any keys in an object are reserved
 * Returns never if reserved fields are found, otherwise returns the type
 */
type ValidateNoReservedFields<T> = keyof T & ReservedFieldNames extends never
    ? T
    : { error: `Reserved field names (${keyof T & ReservedFieldNames & string}) cannot be used. Reserved: id` };

/**
 * Schema for a single collection
 * Maps field names to field descriptors
 */
export type CollectionSchema = {
    [fieldName: string]: FieldDescriptor;
};

/**
 * Type definition for a collection
 * Wraps field definitions and validates no reserved names are used
 * Generic over TVersioned to preserve literal true/false type for compile-time checks
 */
export interface CollectionType<
    TFields extends CollectionSchema = CollectionSchema,
    TVersioned extends boolean = boolean
> {
    readonly _tag: 'CollectionType';
    readonly fields: TFields;
    /**
     * Whether to track versions for fields in this collection
     * - true: Field-level LWW conflict resolution enabled
     * - false (default): Simple overwrite, all versions are 0
     */
    readonly versioned: TVersioned;
}

/**
 * Define a collection type with field definitions
 * Validates that no reserved field names are used
 *
 * @param config.fields - Field definitions for the collection
 * @param config.versioned - Whether to track field-level versions (default: false)
 *
 * @example
 * const schema = defineSchema({
 *   todos: type({
 *     fields: {
 *       title: mutable<string>(),
 *       completed: mutable<boolean>(),
 *     },
 *     versioned: true  // Enable LWW conflict resolution
 *   })
 * });
 */
export function type<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
        versioned: true;
    }
): CollectionType<TFields, true>;

export function type<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
    }
): CollectionType<TFields, false>;

export function type<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
        versioned?: true;
    }
): CollectionType<TFields, boolean> {
    return {
        _tag: 'CollectionType',
        fields: config.fields as TFields,
        versioned: (config.versioned ?? false) as boolean,
    };
}

/**
 * Object type definition for a singleton instance
 * Unlike CollectionType, represents a single instance without key indexing
 * Generic over TVersioned to preserve literal true/false type for compile-time checks
 */
export interface ObjectType<
    TFields extends CollectionSchema = CollectionSchema,
    TVersioned extends boolean = boolean
> {
    readonly _tag: 'ObjectType';
    readonly fields: TFields;
    /**
     * Whether to track versions for fields in this object
     * - true: Field-level LWW conflict resolution enabled
     * - false (default): Simple overwrite, all versions are 0
     */
    readonly versioned: TVersioned;
}

/**
 * Define a singleton object type with field definitions
 * Validates that no reserved field names are used
 * Accessed directly without key indexing (e.g., state.settings vs state.todos['id'])
 *
 * @param config.fields - Field definitions for the object
 * @param config.versioned - Whether to track field-level versions (default: false)
 *
 * @example
 * const schema = defineSchema({
 *   types: {
 *     settings: object({
 *       fields: {
 *         theme: field<string>(),
 *         fontSize: field<number>(),
 *       },
 *       versioned: true  // Enable LWW conflict resolution
 *     })
 *   }
 * });
 */
export function object<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
        versioned: true;
    }
): ObjectType<TFields, true>;

export function object<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
    }
): ObjectType<TFields, false>;

export function object<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
        versioned?: true;
    }
): ObjectType<TFields, boolean> {
    return {
        _tag: 'ObjectType',
        fields: config.fields as TFields,
        versioned: (config.versioned ?? false) as boolean,
    };
}

/**
 * Complete schema definition
 * Maps names to their type definitions (collections or singleton objects)
 */
export type SchemaDefinition = {
    [name: string]: CollectionType | ObjectType;
};

// ============================================================================
// Mutation Definitions
// ============================================================================

/**
 * Mutation handler function that applies a mutation to the state
 * Uses Immer for immutable updates - mutate the draft directly
 *
 * The handler receives:
 * - draft: Mutable draft of the current state (via Immer)
 * - input: The input data for this mutation
 *
 * @typeParam TState - The state type (inferred from schema when using defineSchema())
 * @typeParam TInput - The input type (inferred from handler parameter)
 */
export type MutationHandler<TState, TInput> = (
    draft: TState,
    input: TInput
) => void;

/**
 * Single mutation descriptor containing the handler function
 */
export interface MutationDescriptor<TState, TInput> {
    /** Handler function that applies the mutation to state */
    handler: MutationHandler<TState, TInput>;
}

/**
 * Mutation definition
 * Maps mutation names to their descriptors (handlers)
 */
export type MutationDefinition<TState = any> = {
    [mutationName: string]: MutationDescriptor<TState, any>;
};

/**
 * Create a mutation descriptor with a handler function
 *
 * The input type is automatically inferred from the handler's parameter.
 * For full type safety, use with `defineSchema().withMutations()`.
 *
 * @param handler - Handler function that applies the mutation to state
 * @returns Mutation descriptor
 *
 * @example
 * // With type safety (recommended):
 * const schema = defineSchema({
 *   todos: type({ fields: { title: field<string>() } })
 * }).withMutations({
 *   createTodo: mutation((draft, input: { id: string; title: string }) => {
 *     draft.todos[input.id] = { id: input.id, title: input.title }; // ✓ Fully typed!
 *   })
 * });
 */
export function mutation<TState, TInput>(
    handler: MutationHandler<TState, TInput>
): MutationDescriptor<TState, TInput> {
    return { handler };
}

/**
 * Complete schema with types and mutations
 * Combines collection type definitions with mutation definitions
 */
export type FullSchemaDefinition = {
    types: SchemaDefinition;
    mutations?: MutationDefinition;
};

/**
 * Helper type to extract all reference field collection names from a field schema
 */
type ExtractReferenceCollections<TField> =
    TField extends ReferenceFieldDescriptor<infer TCollection, any> ? TCollection : never;

/**
 * Helper type to extract all reference collection names from a collection schema
 */
type ExtractAllReferences<TSchema extends CollectionSchema> = {
    [K in keyof TSchema]: ExtractReferenceCollections<TSchema[K]>;
}[keyof TSchema];

/**
 * Helper type to validate all references in a schema definition
 * Returns a type error if any reference points to a non-existent collection
 */
type ValidateReferences<TSchema extends SchemaDefinition> = {
    [K in keyof TSchema]: ExtractAllReferences<TSchema[K]['fields']> extends never
        ? TSchema[K]
        : ExtractAllReferences<TSchema[K]['fields']> extends keyof TSchema
            ? TSchema[K]
            : {
                error: `Invalid reference in collection '${K & string}': references '${ExtractAllReferences<TSchema[K]['fields']> & string}' which does not exist in schema. Available collections: ${keyof TSchema & string}`;
            };
};

/**
 * Helper type to validate references in a full schema definition
 */
type ValidateFullSchema<T extends FullSchemaDefinition> =
    T extends { types: infer TTypes; mutations: infer TMutations }
        ? {
            types: ValidateReferences<TTypes extends SchemaDefinition ? TTypes : never>;
            mutations: TMutations;
          }
        : {
            types: ValidateReferences<T['types']>;
          };

/**
 * Typed schema object returned by defineSchema
 */
export type Schema<T extends FullSchemaDefinition> = {
    /**
     * Runtime schema data
     * Preserves the schema definition for later use (e.g., validation)
     */
    readonly _schema: T;

    /**
     * Get the field schema for a specific collection
     */
    collection<K extends keyof T['types']>(name: K): T['types'][K] extends CollectionType<infer TFields> ? TFields : never;

    /**
     * Get the mutation descriptor for a specific mutation
     */
    mutation<K extends keyof NonNullable<T['mutations']>>(name: K): NonNullable<T['mutations']>[K];

    /**
     * Get all mutation names
     */
    mutations(): T['mutations'] extends MutationDefinition ? (keyof T['mutations'])[] : never;

    /**
     * Add mutations with full type safety (chainable)
     * The draft parameter in mutation handlers will be properly typed
     * Can be called multiple times to progressively add mutations
     * Throws error if mutation names already exist
     *
     * @param mutations - Mutation definitions with handlers
     * @returns New schema with merged mutations (chainable)
     */
    withMutations<TNewMutations extends MutationDefinition<InferStateFromTypes<T['types']>>>(
        mutations: TNewMutations
    ): Schema<{
        types: T['types'];
        mutations: (T['mutations'] extends object ? T['mutations'] : {}) & TNewMutations;
    }>;
};

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Helper type to flatten intersection types into a single object type
 * Improves type readability in IDE hover tooltips
 */
type Simplify<T> = { [K in keyof T]: T[K] };

/**
 * Helper type to extract SchemaDefinition from Schema or use raw FullSchemaDefinition
 */
export type ExtractSchemaDefinition<T> = T extends Schema<infer S>
    ? S['types']
    : T extends FullSchemaDefinition
        ? T['types']
        : T extends SchemaDefinition
            ? T
            : never;

/**
 * Infer all collection names from a schema as a union type
 *
 * Returns a union of all collection names defined in the schema.
 *
 * @example
 * const schema = defineSchema({
 *   users: type({ fields: { name: mutable<string>() } }),
 *   todos: type({ fields: { title: mutable<string>() } })
 * });
 *
 * type Collections = InferCollections<typeof schema>;
 * // 'users' | 'todos'
 */
export type InferCollections<TSchema> = keyof ExtractSchemaDefinition<TSchema>;

/**
 * Helper type to extract CollectionSchema fields from a collection or object type
 */
export type ExtractFields<T> = T extends CollectionType<infer TFields>
    ? TFields
    : T extends ObjectType<infer TFields>
        ? TFields
        : never;

/**
 * Filter fields to only include server fields (field + reference, excludes local)
 */
export type ServerFieldsOnly<TFields extends CollectionSchema> = {
    [K in keyof TFields as TFields[K]['fieldType'] extends 'field' | 'reference' ? K : never]: TFields[K];
};

/**
 * Filter fields to only include local fields (fieldType === 'local')
 */
export type LocalFieldsOnly<TFields extends CollectionSchema> = {
    [K in keyof TFields as TFields[K]['fieldType'] extends 'local' ? K : never]: TFields[K];
};

/**
 * Filter fields to include server, local, and reference fields (all fields)
 */
export type ServerAndLocalFields<TFields extends CollectionSchema> = {
    [K in keyof TFields as TFields[K]['fieldType'] extends 'field' | 'local' | 'reference' ? K : never]: TFields[K];
};

/**
 * Helper to infer the value type for a field in Create/Update
 * - Regular fields: plain value T
 * - Local fields: plain value T
 * - References (non-nullable): string
 * - References (nullable): string | null
 */
export type InferFieldValue<TField> =
    TField extends ReferenceFieldDescriptor<any, infer TNullable>
        ? TNullable extends true ? string | null : string
        : TField extends LocalFieldDescriptor<infer T>
            ? T
            : TField extends FieldDescriptor<infer T>
                ? T
                : never;

/**
 * Infer the Create input type for a collection
 *
 * Returns an object with:
 * - id: string (required - must specify the item ID)
 * - All user-defined fields EXCEPT local fields
 * - Regular fields as plain values
 * - Reference fields as string (or string | null if nullable)
 * - Local fields are NOT included (they use default values)
 *
 * @example
 * type CreateTodo = InferCreate<typeof schema, 'todos'>;
 * // { id: string; title: string; completed: boolean; assignedTo: string }
 */
export type InferCreate<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]> as ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]['fieldType'] extends 'local' ? never : K]: InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Infer the Update input type for a collection
 *
 * Returns a partial object with:
 * - id: string (required - must specify which item to update)
 * - All fields (regular and local) are optional
 * - References cannot be updated (they're immutable)
 * - Values are plain (not wrapped)
 *
 * @example
 * type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
 * // { id: string; title?: string; completed?: boolean; isSelected?: boolean }
 */
export type InferUpdate<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]> as ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]['fieldType'] extends 'field' | 'local' ? K : never]?:
        InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Infer the full Update input type for a collection
 *
 * Returns an object with:
 * - id: string (required - must specify which item to update)
 * - All fields (regular and local) are required
 * - References cannot be updated (they're immutable)
 * - Values are plain (not wrapped)
 * - Useful for complete item replacement operations
 *
 * @example
 * type UpdateFullTodo = InferUpdateFull<typeof schema, 'todos'>;
 * // { id: string; title: string; completed: boolean; isSelected: boolean }
 */
export type InferUpdateFull<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]> as ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]['fieldType'] extends 'field' | 'local' ? K : never]:
        InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Helper to infer the item representation for a field
 * - Regular fields: { value: T, version: number }
 * - Local fields: { value: T, version: number }
 * - References: string or string | null (no version tracking)
 */
type InferItemField<TField> =
    TField extends ReferenceFieldDescriptor<any, infer TNullable>
        ? TNullable extends true ? string | null : string
        : TField extends RegularFieldDescriptor<infer T>
            ? { value: T; version: number }
            : TField extends LocalFieldDescriptor<infer T>
                ? { value: T; version: number }
                : never;

/**
 * Infer the in-memory Item type for a collection
 *
 * Returns an object with:
 * - id: string (auto-added)
 * - Mutable fields as { value: T, version: number }
 * - Immutable fields as plain values
 * - Reference fields as string (or string | null if nullable)
 *
 * @example
 * type Todo = InferItem<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   title: { value: string; version: number };
 * //   completed: { value: boolean; version: number };
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferItem<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>]: InferItemField<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Infer the plain item state type for a collection
 *
 * Returns an object with:
 * - id: string (auto-added)
 * - All fields as plain values (no { value, version } wrapping)
 * - Mutable fields as plain values
 * - Immutable fields as plain values
 * - Reference fields as string (or string | null if nullable)
 *
 * This is useful for working with items in a simplified state where you don't need
 * to track individual field versions.
 *
 * @example
 * type TodoState = InferItemState<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   title: string;
 * //   completed: boolean;
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferItemState<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>]: InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Helper to infer the server-side representation for a field
 * All fields (mutable, immutable, local, and references) are wrapped with FieldValue
 * Only difference from client-side is that all fields have { value, version } structure
 */
type InferServerField<TField> =
    TField extends ReferenceFieldDescriptor<any, infer TNullable>
        ? TNullable extends true
            ? FieldValue<string | null>
            : FieldValue<string>
        : TField extends FieldDescriptor<infer T>
            ? FieldValue<T>
            : never;

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
 * Conditional version field - only present when versioned = true
 */
type ConditionalVersionField<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> =
    HasVersionTracking<TSchema, TCollection> extends true
        ? { $version: Version }
        : Record<string, never>;

/**
 * Infer the server-side item state type for a collection
 *
 * Returns an object with:
 * - id: string (unwrapped - unique identifier)
 * - version: number (only when versioned = true for the collection)
 * - All other fields wrapped as { value: T, version: number }
 * - Mutable fields: FieldValue<T>
 * - Immutable fields: FieldValue<T>
 * - Local fields: FieldValue<T>
 * - Reference fields: FieldValue<string> or FieldValue<string | null>
 *
 * This is the internal server snapshot representation used for LWW conflict resolution.
 *
 * @example
 * // With versioned = true
 * type TodoServerState = InferServerItemState<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   version: number;
 * //   title: FieldValue<string>;
 * //   completed: FieldValue<boolean>;
 * // }
 *
 * // With versioned = false
 * type SettingsServerState = InferServerItemState<typeof schema, 'settings'>;
 * // {
 * //   id: string;
 * //   theme: FieldValue<string>;
 * // }
 */
export type InferServerItemState<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & ConditionalVersionField<TSchema, TCollection> & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>]: InferServerField<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

// ============================================================================
// Singleton Object Type Inference
// ============================================================================

/**
 * Infer the plain state type for a singleton object (no id field)
 *
 * Returns an object with:
 * - All fields as plain values (no { value, version } wrapping)
 * - No id field (singleton doesn't need one)
 *
 * @example
 * type SettingsState = InferObjectState<typeof schema, 'settings'>;
 * // {
 * //   theme: string;
 * //   fontSize: number;
 * // }
 */
export type InferObjectState<TSchema, TObject extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TObject]>]: InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TObject]>[K]>;
}>;

/**
 * Infer the server-side state type for a singleton object (no id field)
 *
 * Returns an object with:
 * - version: number (only when versioned = true for the object)
 * - All fields wrapped as { value: T, version: number }
 * - No id field (singleton doesn't need one)
 *
 * @example
 * // With versioned = true
 * type SettingsServerState = InferServerObjectState<typeof schema, 'settings'>;
 * // {
 * //   version: number;
 * //   theme: FieldValue<string>;
 * //   fontSize: FieldValue<number>;
 * // }
 */
export type InferServerObjectState<TSchema, TObject extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<
    ConditionalVersionField<TSchema, TObject> & {
        [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TObject]>]: InferServerField<ExtractFields<ExtractSchemaDefinition<TSchema>[TObject]>[K]>;
    }
>;

/**
 * Helper type to extract all field values from a collection schema
 * - Regular fields: plain value T
 * - References: string or string | null
 */
type DenormalizedValues<TSchema extends CollectionSchema> = {
    [K in keyof TSchema]: InferFieldValue<TSchema[K]>;
};

/**
 * Helper type to extract version fields for regular and local fields
 * References don't have version
 */
type DenormalizedVersion<TSchema extends CollectionSchema> = {
    [K in keyof TSchema & string as TSchema[K]['fieldType'] extends 'field' | 'local' ? `${K}Version` : never]: number;
};

/**
 * Infer the denormalized (database) representation for a collection
 *
 * Returns a flat object with:
 * - id: string (auto-added)
 * - Mutable fields as two properties: field and fieldVersion
 * - Immutable fields as single property
 * - Reference fields as single property (string or string | null)
 *
 * @example
 * type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   title: string;
 * //   titleVersion: number;
 * //   completed: boolean;
 * //   completedVersion: number;
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferDenormalized<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<
    {
        id: string;
    } & DenormalizedValues<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>>
      & DenormalizedVersion<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>>
>;

/**
 * Helper type to extract mutation definitions from a schema
 */
type ExtractMutationDefinition<T> = T extends Schema<infer S>
    ? S['mutations']
    : T extends FullSchemaDefinition
        ? T['mutations']
        : never;

/**
 * Infer the input type for a mutation from its Zod schema
 *
 * Returns the inferred input type from the Zod schema.
 *
 * @example
 * const schema = defineSchema({
 *   types: { ... },
 *   mutations: {
 *     createTodo: mutation(
 *       z.object({ title: z.string(), completed: z.boolean() }),
 *       (draft, input) => { ... }
 *     )
 *   }
 * });
 *
 * type CreateTodoInput = InferMutationInput<typeof schema, 'createTodo'>;
 * // { title: string; completed: boolean }
 */
export type InferMutationInput<TSchema, TMutation extends keyof NonNullable<ExtractMutationDefinition<TSchema>>> =
    NonNullable<ExtractMutationDefinition<TSchema>>[TMutation] extends MutationDescriptor<any, infer TInput>
        ? TInput
        : never;

/**
 * Infer the output type for a mutation from its Zod schema
 *
 * Returns the inferred output type from the Zod schema (after parsing).
 *
 * @example
 * const schema = defineSchema({
 *   types: { ... },
 *   mutations: {
 *     createTodo: mutation(
 *       z.object({ title: z.string(), completed: z.boolean().default(false) }),
 *       (draft, input) => { ... }
 *     )
 *   }
 * });
 *
 * type CreateTodoOutput = InferMutationOutput<typeof schema, 'createTodo'>;
 * // { title: string; completed: boolean }
 */
export type InferMutationOutput<TSchema, TMutation extends keyof NonNullable<ExtractMutationDefinition<TSchema>>> =
    NonNullable<ExtractMutationDefinition<TSchema>>[TMutation] extends MutationDescriptor<any, infer TInput>
        ? TInput
        : never;

/**
 * Infer all mutation names from a schema as a union type
 *
 * Returns a union of all mutation names defined in the schema.
 *
 * @example
 * const schema = defineSchema({
 *   types: { ... },
 *   mutations: {
 *     createTodo: z.object({ title: z.string() }),
 *     updateTodo: z.object({ id: z.string(), title: z.string().optional() })
 *   }
 * });
 *
 * type Mutations = InferMutations<typeof schema>;
 * // 'createTodo' | 'updateTodo'
 */
export type InferMutations<TSchema> = keyof NonNullable<ExtractMutationDefinition<TSchema>>;

// ============================================================================
// Initial Values Type Inference
// ============================================================================

/**
 * Extract only object (singleton) types from schema definition
 * Filters out collection types, returns only ObjectType entries
 *
 * @example
 * type Schema = {
 *   settings: ObjectType<...>;
 *   todos: CollectionType<...>;
 * };
 * type Objects = ExtractObjectTypes<Schema>;
 * // { settings: ObjectType<...> }
 */
export type ExtractObjectTypes<T extends SchemaDefinition> = {
    [K in keyof T as T[K] extends ObjectType ? K : never]: T[K];
};

/**
 * Infer the required initial values for all singleton objects in schema
 * Returns an object with plain values (not FieldValue wrapped)
 * Only includes objects (ObjectType), excludes collections (CollectionType)
 * Excludes local fields (they use default values)
 *
 * @example
 * const schema = defineSchema({
 *   types: {
 *     settings: object({ fields: { theme: field<string>() } }),
 *     todos: type({ fields: { title: field<string>() } })
 *   }
 * });
 *
 * type InitialValues = InferInitialObjectValues<typeof schema._schema>;
 * // { settings: { theme: string } }
 * // Note: 'todos' is excluded because it's a collection
 */
export type InferInitialObjectValues<T extends FullSchemaDefinition> = {
    [K in keyof ExtractObjectTypes<T['types']>]: {
        [F in keyof ExtractFields<T['types'][K]> as ExtractFields<T['types'][K]>[F]['fieldType'] extends 'local' ? never : F]:
            InferFieldValue<ExtractFields<T['types'][K]>[F]>
    }
};

/**
 * Helper to check if schema has any object types
 */
type HasObjectTypes<T extends FullSchemaDefinition> =
    keyof ExtractObjectTypes<T['types']> extends never ? false : true;

/**
 * Conditional type for initial values parameter
 * - If schema has objects: required parameter with proper structure
 * - If schema has no objects: empty object
 *
 * @example
 * // Schema with objects
 * type ParamWithObjects = InitialObjectValuesParam<SchemaWithObjects>;
 * // { settings: { theme: string; fontSize: number } }
 *
 * // Schema without objects
 * type ParamNoObjects = InitialObjectValuesParam<SchemaWithoutObjects>;
 * // {}
 */
export type InitialObjectValuesParam<T extends FullSchemaDefinition> =
    HasObjectTypes<T> extends true
        ? InferInitialObjectValues<T>
        : Record<string, never>;

// ============================================================================
// Schema Definition Functions
// ============================================================================

/**
 * Helper type to infer state structure from type definitions
 * Used internally to provide type safety in mutation handlers
 */
type InferStateFromTypes<TTypes extends SchemaDefinition> = {
    [K in keyof TTypes]: TTypes[K] extends CollectionType
        ? Record<string, InferItemState<Schema<{ types: TTypes; mutations: {} }>, K>>
        : TTypes[K] extends ObjectType
            ? InferObjectState<Schema<{ types: TTypes; mutations: {} }>, K>
            : never;
};

/**
 * Define a schema with type definitions (collections and singleton objects)
 * Returns a schema with full type safety for mutation handlers via .withMutations()
 *
 * This approach gives you TypeScript autocomplete and type checking in mutation handlers.
 * Chain .withMutations() calls to progressively add mutations.
 *
 * @param types - Type definitions (collections and singleton objects)
 * @returns Schema with empty mutations and chainable .withMutations() method
 *
 * @example
 * const schema = defineSchema({
 *   todos: type({
 *     fields: {
 *       title: field<string>(),
 *       completed: field<boolean>(),
 *     },
 *   }),
 * }).withMutations({
 *   createTodo: mutation(
 *     z.object({ id: z.string(), title: z.string() }),
 *     (draft, input) => {
 *       // draft is fully typed! Autocomplete works here!
 *       draft.todos[input.id] = {
 *         id: input.id,
 *         title: input.title,
 *         completed: false,
 *       };
 *     }
 *   ),
 * }).withMutations({
 *   updateTodo: mutation(
 *     z.object({ id: z.string(), completed: z.boolean() }),
 *     (draft, input) => {
 *       if (draft.todos[input.id]) {
 *         draft.todos[input.id].completed = input.completed;
 *       }
 *     }
 *   ),
 * });
 */
export function defineSchema<TTypes extends SchemaDefinition>(
    types: ValidateReferences<TTypes> extends TTypes ? TTypes : ValidateReferences<TTypes>
): Schema<{ types: TTypes; mutations: {} }> {
    const validatedTypes = types as TTypes;
    const fullSchema = { types: validatedTypes, mutations: {} };
    return createSchemaInternal(fullSchema as any) as Schema<{ types: TTypes; mutations: {} }>;
}

/**
 * Internal helper to create a schema object from a full schema definition
 * Used internally by defineSchema() and withMutations()
 *
 * @param schema - Full schema definition with types and mutations
 * @returns Typed schema object with all methods
 */
function createSchemaInternal<T extends FullSchemaDefinition>(
    schema: ValidateFullSchema<T> extends T ? T : ValidateFullSchema<T>
): Schema<T> {
    const s = schema as T;

    return {
        _schema: s,
        collection<K extends keyof T['types']>(name: K) {
            const types = s.types as Record<string, CollectionType>;
            return types[name as string]?.fields;
        },
        mutation<K extends keyof NonNullable<T['mutations']>>(name: K) {
            if (!s.mutations) {
                throw new Error(`Mutations are not defined in this schema`);
            }
            const mutations = s.mutations as Record<string, unknown>;
            return mutations[name as string];
        },
        mutations() {
            return s.mutations ? Object.keys(s.mutations) as (keyof T['mutations'])[] : [] as never;
        },
        withMutations<TNewMutations extends MutationDefinition<InferStateFromTypes<T['types']>>>(
            newMutations: TNewMutations
        ): Schema<{
            types: T['types'];
            mutations: (T['mutations'] extends object ? T['mutations'] : {}) & TNewMutations;
        }> {
            // Check for duplicate mutation names
            const existingMutations = s.mutations ?? {};
            for (const mutationName in newMutations) {
                if (mutationName in existingMutations) {
                    throw new Error(
                        `Mutation '${mutationName}' already exists. Cannot add duplicate mutation names. ` +
                        `Use a different name or remove the existing mutation first.`
                    );
                }
            }

            // Merge mutations
            const mergedMutations = { ...existingMutations, ...newMutations };
            const mergedSchema = { types: s.types, mutations: mergedMutations };

            return createSchemaInternal(mergedSchema as any);
        },
    } as Schema<T>;
}
