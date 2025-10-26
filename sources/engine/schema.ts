/**
 * Schema DSL for defining collection types
 *
 * Provides a declarative way to define schemas for collections with:
 * - Mutable fields (with changedAt tracking)
 * - Immutable fields (plain values)
 * - Automatic type inference for Create, Update, Item, and Denormalized representations
 */

import type { z } from 'zod';

// ============================================================================
// Field Descriptors
// ============================================================================

/**
 * Field type discriminator
 */
export type FieldType = 'mutable' | 'immutable' | 'reference' | 'local';

/**
 * Mutable field descriptor
 * Mutable fields track when they were last changed
 */
export interface MutableFieldDescriptor<T = unknown> {
    readonly fieldType: 'mutable';
    // Phantom type parameter for TypeScript type inference
    readonly __type?: T;
}

/**
 * Immutable field descriptor
 * Immutable fields are set once and never change
 */
export interface ImmutableFieldDescriptor<T = unknown> {
    readonly fieldType: 'immutable';
    // Phantom type parameter for TypeScript type inference
    readonly __type?: T;
}

/**
 * Local field descriptor
 * Local fields are client-side only and track when they were last changed
 * - Always initialized with a default value
 * - Can be mutated locally (tracked with changedAt)
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
    | MutableFieldDescriptor<T>
    | ImmutableFieldDescriptor<T>
    | LocalFieldDescriptor<T>
    | ReferenceFieldDescriptor<any, any>;

/**
 * Create a mutable field descriptor
 * Mutable fields track when they were last changed
 *
 * @example
 * const schema = defineSchema({
 *   todos: {
 *     title: mutable<string>(),
 *     completed: mutable<boolean>(),
 *   }
 * });
 */
export function mutable<T>(): MutableFieldDescriptor<T> {
    return { fieldType: 'mutable' } as MutableFieldDescriptor<T>;
}

/**
 * Create an immutable field descriptor
 * Immutable fields are set once and never change
 *
 * @example
 * const schema = defineSchema({
 *   todos: {
 *     priority: immutable<number>(),
 *   }
 * });
 */
export function immutable<T>(): ImmutableFieldDescriptor<T> {
    return { fieldType: 'immutable' } as ImmutableFieldDescriptor<T>;
}

/**
 * Create a local field descriptor
 * Local fields are client-side only and not synced from server
 *
 * Local fields:
 * - Always have a default value
 * - Track changes locally (with changedAt timestamp)
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
type ReservedFieldNames = 'id' | 'createdAt' | 'updatedAt';

/**
 * Helper type to check if any keys in an object are reserved
 * Returns never if reserved fields are found, otherwise returns the type
 */
type ValidateNoReservedFields<T> = keyof T & ReservedFieldNames extends never
    ? T
    : { error: `Reserved field names (${keyof T & ReservedFieldNames & string}) cannot be used. Reserved: id, createdAt, updatedAt` };

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
 */
export interface CollectionType<TFields extends CollectionSchema = CollectionSchema> {
    readonly _tag: 'CollectionType';
    readonly fields: TFields;
}

/**
 * Define a collection type with field definitions
 * Validates that no reserved field names are used
 *
 * @example
 * const schema = defineSchema({
 *   todos: type({
 *     fields: {
 *       title: mutable<string>(),
 *       completed: mutable<boolean>(),
 *     }
 *   })
 * });
 */
export function type<TFields extends CollectionSchema>(
    config: {
        fields: ValidateNoReservedFields<TFields>;
    }
): CollectionType<TFields> {
    return {
        _tag: 'CollectionType',
        fields: config.fields as TFields,
    };
}

/**
 * Complete schema definition
 * Maps collection names to their type definitions
 */
export type SchemaDefinition = {
    [collectionName: string]: CollectionType;
};

// ============================================================================
// Mutation Definitions
// ============================================================================

/**
 * Mutation definition
 * Maps mutation names to their Zod schema types
 */
export type MutationDefinition = {
    [mutationName: string]: z.ZodTypeAny;
};

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
type ValidateFullSchema<T extends FullSchemaDefinition> = {
    types: ValidateReferences<T['types']> extends T['types'] ? T['types'] : ValidateReferences<T['types']>;
    mutations: T['mutations'];
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
     * Get the Zod schema for a specific mutation
     */
    mutation<K extends keyof NonNullable<T['mutations']>>(name: K): NonNullable<T['mutations']>[K];

    /**
     * Get all mutation names
     */
    mutations(): T['mutations'] extends MutationDefinition ? (keyof T['mutations'])[] : never;
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
type ExtractSchemaDefinition<T> = T extends Schema<infer S>
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
 * Helper type to extract CollectionSchema fields from a collection type
 */
type ExtractFields<T> = T extends CollectionType<infer TFields> ? TFields : never;

/**
 * Helper to infer the value type for a field in Create/Update
 * - Mutable fields: plain value T
 * - Immutable fields: plain value T
 * - Local fields: plain value T
 * - References (non-nullable): string
 * - References (nullable): string | null
 */
type InferFieldValue<TField> =
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
 * - Mutable fields as plain values
 * - Immutable fields as plain values
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
 * - Only mutable and local fields (immutable fields and references cannot be updated)
 * - All mutable and local fields are optional
 * - Values are plain (not wrapped)
 *
 * @example
 * type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
 * // { id: string; title?: string; completed?: boolean; isSelected?: boolean }
 */
export type InferUpdate<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]> as ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]['fieldType'] extends 'mutable' | 'local' ? K : never]?:
        InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Helper to infer the item representation for a field
 * - Mutable fields: { value: T, changedAt: number }
 * - Local fields: { value: T, changedAt: number }
 * - Immutable fields: plain value T
 * - References: string or string | null (no changedAt tracking)
 */
type InferItemField<TField> =
    TField extends ReferenceFieldDescriptor<any, infer TNullable>
        ? TNullable extends true ? string | null : string
        : TField extends MutableFieldDescriptor<infer T>
            ? { value: T; changedAt: number }
            : TField extends LocalFieldDescriptor<infer T>
                ? { value: T; changedAt: number }
                : TField extends ImmutableFieldDescriptor<infer T>
                    ? T
                    : never;

/**
 * Infer the in-memory Item type for a collection
 *
 * Returns an object with:
 * - id: string (auto-added)
 * - createdAt: number (auto-added immutable)
 * - Mutable fields as { value: T, changedAt: number }
 * - Immutable fields as plain values
 * - Reference fields as string (or string | null if nullable)
 *
 * @example
 * type Todo = InferItem<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   createdAt: number;
 * //   title: { value: string; changedAt: number };
 * //   completed: { value: boolean; changedAt: number };
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferItem<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
    createdAt: number;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>]: InferItemField<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Infer the plain item state type for a collection
 *
 * Returns an object with:
 * - id: string (auto-added)
 * - createdAt: number (auto-added immutable)
 * - All fields as plain values (no { value, changedAt } wrapping)
 * - Mutable fields as plain values
 * - Immutable fields as plain values
 * - Reference fields as string (or string | null if nullable)
 *
 * This is useful for working with items in a simplified state where you don't need
 * to track individual field change timestamps.
 *
 * @example
 * type TodoState = InferItemState<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   createdAt: number;
 * //   title: string;
 * //   completed: boolean;
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferItemState<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<{
    id: string;
    createdAt: number;
} & {
    [K in keyof ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>]: InferFieldValue<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>[K]>;
}>;

/**
 * Helper type to extract all field values from a collection schema
 * - Mutable/Immutable fields: plain value T
 * - References: string or string | null
 */
type DenormalizedValues<TSchema extends CollectionSchema> = {
    [K in keyof TSchema]: InferFieldValue<TSchema[K]>;
};

/**
 * Helper type to extract changedAt fields for mutable and local fields
 * References and immutable fields don't have changedAt
 */
type DenormalizedChangedAt<TSchema extends CollectionSchema> = {
    [K in keyof TSchema & string as TSchema[K]['fieldType'] extends 'mutable' | 'local' ? `${K}ChangedAt` : never]: number;
};

/**
 * Infer the denormalized (database) representation for a collection
 *
 * Returns a flat object with:
 * - id: string (auto-added)
 * - createdAt: number (auto-added immutable)
 * - Mutable fields as two properties: field and fieldChangedAt
 * - Immutable fields as single property
 * - Reference fields as single property (string or string | null)
 *
 * @example
 * type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;
 * // {
 * //   id: string;
 * //   createdAt: number;
 * //   title: string;
 * //   titleChangedAt: number;
 * //   completed: boolean;
 * //   completedChangedAt: number;
 * //   priority: number;
 * //   assignedTo: string;
 * // }
 */
export type InferDenormalized<TSchema, TCollection extends keyof ExtractSchemaDefinition<TSchema>> = Simplify<
    {
        id: string;
        createdAt: number;
    } & DenormalizedValues<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>>
      & DenormalizedChangedAt<ExtractFields<ExtractSchemaDefinition<TSchema>[TCollection]>>
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
 *     createTodo: z.object({ title: z.string(), completed: z.boolean() }),
 *   }
 * });
 *
 * type CreateTodoInput = InferMutationInput<typeof schema, 'createTodo'>;
 * // { title: string; completed: boolean }
 */
export type InferMutationInput<TSchema, TMutation extends keyof NonNullable<ExtractMutationDefinition<TSchema>>> =
    NonNullable<ExtractMutationDefinition<TSchema>>[TMutation] extends z.ZodTypeAny
        ? z.input<NonNullable<ExtractMutationDefinition<TSchema>>[TMutation]>
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
 *     createTodo: z.object({ title: z.string(), completed: z.boolean().default(false) }),
 *   }
 * });
 *
 * type CreateTodoOutput = InferMutationOutput<typeof schema, 'createTodo'>;
 * // { title: string; completed: boolean }
 */
export type InferMutationOutput<TSchema, TMutation extends keyof NonNullable<ExtractMutationDefinition<TSchema>>> =
    NonNullable<ExtractMutationDefinition<TSchema>>[TMutation] extends z.ZodTypeAny
        ? z.output<NonNullable<ExtractMutationDefinition<TSchema>>[TMutation]>
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
// Schema Definition Function
// ============================================================================

/**
 * Helper to detect if a schema definition is in the old format (direct SchemaDefinition)
 * or new format (FullSchemaDefinition with types/mutations)
 */
function isFullSchemaDefinition(schema: unknown): schema is FullSchemaDefinition {
    return typeof schema === 'object' && schema !== null && 'types' in schema;
}

// Overload signatures
export function defineSchema<T extends SchemaDefinition>(
    schema: ValidateReferences<T> extends T ? T : ValidateReferences<T>
): Schema<{ types: T; mutations?: undefined }>;
export function defineSchema<T extends FullSchemaDefinition>(
    schema: ValidateFullSchema<T> extends T ? T : ValidateFullSchema<T>
): Schema<T>;

/**
 * Define a schema for collections and mutations
 * Validates that all references point to collections that exist in the schema
 *
 * @param schema - Schema definition (SchemaDefinition or FullSchemaDefinition with types and optional mutations)
 * @returns Typed schema object with type inference utilities
 *
 * @example
 * // New format with types and mutations
 * const schema = defineSchema({
 *   types: {
 *     users: type({
 *       fields: {
 *         name: mutable<string>(),
 *       }
 *     }),
 *     todos: type({
 *       fields: {
 *         title: mutable<string>(),
 *         assignedTo: reference('users'), // Valid - 'users' exists
 *       }
 *     })
 *   },
 *   mutations: {
 *     createTodo: z.object({ title: z.string() }),
 *     updateTodo: z.object({ id: z.string(), title: z.string().optional() })
 *   }
 * });
 *
 * // Old format (backward compatible - automatically wrapped in types)
 * const legacySchema = defineSchema({
 *   users: type({
 *     fields: {
 *       name: mutable<string>(),
 *     }
 *   }),
 *   todos: type({
 *     fields: {
 *       title: mutable<string>(),
 *     }
 *   })
 * });
 *
 * // Use type inference
 * type CreateTodo = InferCreate<typeof schema, 'todos'>;
 * type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
 * type Todo = InferItem<typeof schema, 'todos'>;
 * type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;
 */
export function defineSchema(schema: unknown): unknown {
    // Normalize to FullSchemaDefinition format
    const normalized: FullSchemaDefinition = isFullSchemaDefinition(schema)
        ? schema
        : { types: schema as SchemaDefinition };

    return {
        _schema: normalized,
        collection(name: string): unknown {
            return normalized.types[name]?.fields;
        },
        mutation(name: string): unknown {
            if (!normalized.mutations) {
                throw new Error(`Mutations are not defined in this schema`);
            }
            return normalized.mutations[name];
        },
        mutations(): string[] {
            return normalized.mutations ? Object.keys(normalized.mutations) : [];
        },
    };
}
