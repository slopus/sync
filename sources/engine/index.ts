/**
 * Sync Engine - Export all public APIs
 */

// Types
export type {
    ItemId,
    Timestamp,
    MutableField,
    Mutable,
    Item,
    CollectionConfig,
    CollectionState,
    OperationId,
    DiffOperation,
    Diff,
    OperationResult,
    DiffResult,
} from './types';

// Collection
export { Collection } from './collection';

// Client Collection
export { ClientCollection } from './client-collection';
export type { PendingOperation, ClientCollectionConfig } from './client-collection';

// Helpers
export {
    createItemId,
    createOperationId,
    mutable,
    mutableAt,
    updateMutable,
} from './helpers';

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
    Schema,
    InferCreate,
    InferUpdate,
    InferItem,
    InferDenormalized,
    InferCollections,
} from './schema';
