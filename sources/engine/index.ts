/**
 * Sync Engine - Export all public APIs
 */

// Types
export type {
    ItemId,
    Timestamp,
    OperationId
} from './types';

// Schema DSL
export {
    defineSchema,
    type,
    mutable as mutableField,
    immutable as immutableField,
    reference,
} from './schema';
export type {
    FieldType,
    MutableFieldDescriptor,
    ImmutableFieldDescriptor,
    ReferenceFieldDescriptor,
    FieldDescriptor,
    CollectionSchema,
    CollectionType,
    SchemaDefinition,
    MutationDefinition,
    FullSchemaDefinition,
    Schema,
    InferCreate,
    InferUpdate,
    InferItem,
    InferItemState,
    InferDenormalized,
    InferCollections,
    InferMutationInput,
    InferMutationOutput,
    InferMutations,
} from './schema';

// Sync Engine
export { sync } from './sync';
export type { SyncState, SyncEngine, PartialServerUpdate, PendingMutation } from './sync';
