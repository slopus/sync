/**
 * Core types for the sync engine
 */

// ============================================================================
// Core Types - Item Identity and Structure
// ============================================================================

/**
 * Every item in the sync engine must have a unique identifier
 * using CUID2 format for distributed ID generation
 */
export type ItemId = string;

/**
 * Timestamp in milliseconds since epoch
 * Used to track when mutable fields were changed
 */
export type Timestamp = number;

// ============================================================================
// Mutable Field Types - Tracking Changes Over Time
// ============================================================================

/**
 * A mutable field wraps a value with metadata about when it was changed.
 * The changedAt timestamp only updates when the actual value changes.
 *
 * @template T - The type of the value being tracked
 */
export type MutableField<T> = {
    value: T | null;
    changedAt: Timestamp;
};

/**
 * Helper type to create a mutable field from a type
 */
export type Mutable<T> = MutableField<T>;

/**
 * Helper type to mark certain fields as mutable in an item shape
 * Usage: Item<{ name: string, status: Mutable<string> }>
 */
export type Item<TShape> = {
    id: ItemId;
} & TShape;

// ============================================================================
// Collection Types - Defining Data Structures
// ============================================================================

/**
 * A collection is a named group of items with a specific shape.
 * All items in a collection must conform to the same shape.
 */
export type CollectionConfig<TShape> = {
    name: string;
    shape: TShape;
};

/**
 * The state of a collection - a map from item IDs to items
 */
export type CollectionState<TShape> = Map<ItemId, Item<TShape>>;

// ============================================================================
// Diff Types - Representing Changes
// ============================================================================

/**
 * Unique identifier for a diff operation
 */
export type OperationId = string;

/**
 * A diff operation that can be applied to a collection.
 * Represents the minimal set of changes to synchronize state.
 * Each operation has a unique ID for tracking acceptance/rejection.
 */
export type DiffOperation<TShape> =
    | { opId: OperationId; type: 'create'; item: Item<TShape> }
    | { opId: OperationId; type: 'update'; id: ItemId; changes: Partial<TShape> }
    | { opId: OperationId; type: 'delete'; id: ItemId };

/**
 * A diff is a collection of operations to apply
 * Operations can be in any order and will be processed independently
 */
export type Diff<TShape> = DiffOperation<TShape>[];

/**
 * Result of applying a single operation
 */
export type OperationResult = {
    accepted: boolean;
    reason?: string;
};

/**
 * Results of applying a diff - maps operation IDs to their results
 */
export type DiffResult = Map<OperationId, OperationResult>;
