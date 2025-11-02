/**
 * Sync Engine - Export all public APIs
 */

// Types
export type {
    ItemId,
    Timestamp,
    OperationId,
    FieldValue,
    Version,
    PersistedState
} from './types';

// Schema DSL
export {
    defineSchema,
    type,
    object,
    field,
    local as localField,
    reference,
    mutation,
} from './schema';
export type {
    FieldType,
    RegularFieldDescriptor,
    LocalFieldDescriptor,
    ReferenceFieldDescriptor,
    FieldDescriptor,
    CollectionSchema,
    CollectionType,
    ObjectType,
    SchemaDefinition,
    MutationDefinition,
    MutationDescriptor,
    MutationHandler,
    FullSchemaDefinition,
    Schema,
    InferCreate,
    InferUpdate,
    InferUpdateFull,
    InferItem,
    InferItemState,
    InferServerItemState,
    InferObjectState,
    InferServerObjectState,
    InferDenormalized,
    InferCollections,
    InferMutationInput,
    InferMutationOutput,
    InferMutations,
    ExtractObjectTypes,
    InferInitialObjectValues,
    ExtractSchemaDefinition,
} from './schema';

// Sync Engine
export { syncEngine } from './engine';
export type {
    SyncState,
    ServerSnapshot,
    SyncEngine,
    PartialServerUpdate,
    PartialUpdate,
    PartialLocalUpdate,
    FullServerUpdate,
    FullUpdate,
    FullLocalUpdate,
    PendingMutation,
    RebaseOptions,
    InitParam
} from './engine';
