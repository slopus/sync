---
title: Sync Engine Architecture
description: Type definitions and architecture for the toy sync engine implementation
---

The sync engine is a TypeScript-based system for managing collections of items with automatic change tracking and synchronization support. It provides a foundation for building distributed, synchronized data stores.

## Core Concepts

The sync engine is built around three key concepts:

1. **Collections** - Named groups of items with consistent shapes
2. **Items** - Individual data records with unique IDs and typed fields
3. **Mutable Fields** - Fields that track both their value and when they last changed

## High-Level Architecture

The system consists of two main components:

- **SyncEngine** - Manages multiple collections and provides a unified interface
- **Collection** - Manages a single collection of items with specific shape

Each collection operates independently but can be coordinated through the sync engine.

## Type System

### Item Identity and Time

```typescript
/**
 * Unique identifier for items using CUID2 format
 * CUID2 provides collision-resistant IDs suitable for distributed systems
 */
type ItemId = string;

/**
 * Timestamp in milliseconds since Unix epoch
 * Used to track when mutable fields were last changed
 */
type Timestamp = number;
```

### Mutable Field System

Mutable fields wrap values with change tracking metadata. The key invariant is that `changedAt` only updates when the actual value changes, not on every write operation.

```typescript
/**
 * A mutable field wraps a value with change tracking metadata
 *
 * Invariants:
 * - changedAt only updates when value actually changes
 * - value can be null
 * - changedAt is always a valid timestamp
 */
type MutableField<T> = {
    value: T | null;
    changedAt: Timestamp;
};

/**
 * Convenience alias for mutable fields
 */
type Mutable<T> = MutableField<T>;
```

### Item Structure

Items combine a required ID with a user-defined shape. Fields in the shape can be either immutable (plain values) or mutable (wrapped in MutableField).

```typescript
/**
 * Base item type with required ID field
 * TShape defines the additional fields for this item type
 *
 * Example:
 * type TodoItem = Item<{
 *   createdAt: number;              // immutable field
 *   title: Mutable<string>;         // mutable field
 *   completed: Mutable<boolean>;    // mutable field
 * }>;
 */
type Item<TShape> = {
    id: ItemId;
} & TShape;
```

### Collection Configuration

```typescript
/**
 * Configuration for a collection
 * Defines the name and shape of items in the collection
 */
type CollectionConfig<TShape> = {
    name: string;
    shape: TShape;
};

/**
 * Internal state of a collection
 * Maps item IDs to item instances for O(1) lookups
 */
type CollectionState<TShape> = Map<ItemId, Item<TShape>>;
```

### Change Representation (Diffs)

Changes to collections are represented as operations that can be applied atomically. This enables:
- Undo/redo functionality
- Network synchronization
- Change history tracking

```typescript
/**
 * Atomic operations that can be applied to a collection
 * Each operation type has specific semantics:
 *
 * - create: Add a new item (fails silently if ID exists)
 * - update: Modify existing item (fails silently if ID doesn't exist)
 * - delete: Remove an item (fails silently if ID doesn't exist)
 */
type DiffOperation<TShape> =
    | { type: 'create'; item: Item<TShape> }
    | { type: 'update'; id: ItemId; changes: Partial<TShape> }
    | { type: 'delete'; id: ItemId };

/**
 * A diff is a sequence of operations
 * Operations are applied in order
 */
type Diff<TShape> = DiffOperation<TShape>[];
```

### Change Notifications

```typescript
/**
 * Callback function invoked when collection changes
 * Receives only the operations that were successfully applied
 * (failed operations are filtered out)
 */
type ChangeListener<TShape> = (changes: Diff<TShape>) => void;
```

## Collection API

The Collection class provides three primary operations:

### 1. Read Operations

```typescript
/**
 * Read all items in the collection
 * Returns a snapshot array (modifications don't affect collection)
 */
read(): Item<TShape>[];

/**
 * Read a specific item by ID
 * Returns undefined if item doesn't exist
 */
readOne(id: ItemId): Item<TShape> | undefined;
```

### 2. Write Operations (Apply Diff)

```typescript
/**
 * Apply a diff to the collection
 *
 * Behavior:
 * - Operations are applied in sequence
 * - Failed operations are skipped (idempotent)
 * - Returns true if any changes were applied
 * - Notifies listeners of successful operations only
 *
 * Mutable field semantics:
 * - changedAt updates only when value actually changes
 * - Value comparison is deep (not reference-based)
 * - Incoming changedAt is ignored if value unchanged
 */
applyDiff(diff: Diff<TShape>): boolean;
```

### 3. Change Notifications

```typescript
/**
 * Subscribe to change notifications
 *
 * Returns an unsubscribe function
 * Listeners are called synchronously after changes apply
 * Exceptions in listeners are caught and logged
 */
onChange(listener: ChangeListener<TShape>): () => void;
```

## Sync Engine API

The SyncEngine manages multiple collections:

```typescript
/**
 * Get or create a collection by name
 * Always returns the same instance for a given name
 */
collection<TShape>(name: string): Collection<TShape>;

/**
 * List all collection names
 */
collectionNames(): string[];

/**
 * Remove a collection by name
 * Returns true if collection existed
 */
removeCollection(name: string): boolean;
```

## Mutable Field Semantics

### Core Principle

The fundamental rule is: **changedAt only updates when the value actually changes**.

### Merge Behavior

When applying updates to mutable fields:

1. Compare incoming value with existing value (deep comparison)
2. If values differ:
   - Update value to incoming value
   - Update changedAt to current time (not incoming changedAt)
3. If values are same:
   - Keep existing value and changedAt unchanged
   - Ignore incoming changedAt entirely

This ensures that changedAt always represents when the value last changed, not when it was last written.

### Helper Functions

```typescript
/**
 * Create a new mutable field
 * Sets changedAt to current time
 */
function mutable<T>(value: T | null): MutableField<T>;

/**
 * Update a mutable field's value
 * Returns same reference if value unchanged
 * Returns new field with updated changedAt if value changed
 */
function updateMutable<T>(
    field: MutableField<T>,
    newValue: T | null
): MutableField<T>;

/**
 * Generate a new unique item ID
 */
function createItemId(): ItemId;
```

## Implementation Details

### Deep Equality

The collection uses deep equality comparison for:
- Determining if mutable field values have changed
- Comparing immutable field values

This means nested objects and arrays are compared by value, not reference.

### Error Handling

- Failed operations (e.g., updating non-existent item) are silently skipped
- Exceptions in change listeners are caught and logged
- Invalid operations don't prevent subsequent operations from applying

### Type Safety

The implementation uses TypeScript's type system to ensure:
- Collections maintain consistent item shapes
- Mutable fields are properly typed
- Operations match collection schema

The SyncEngine uses type erasure internally but maintains type safety at the API level through generics.

## Design Rationale

### Why Mutable Fields Track Changes

Traditional versioning systems track when records change, but not individual fields. By tracking field-level changes, we enable:

- **Conflict Resolution** - Know which version of a field is newer
- **Selective Sync** - Only sync fields that changed
- **Change History** - Track evolution of individual fields
- **Optimistic UI** - Show local changes while syncing

### Why Operations Are Idempotent

Making operations idempotent (safe to apply multiple times) enables:

- **Retry Logic** - Safely retry failed operations
- **Out-of-Order Delivery** - Handle network reordering
- **Simplicity** - No need for operation deduplication

### Why Deep Equality for Mutable Fields

Using deep equality instead of reference equality ensures:

- **Correct Change Detection** - Detect actual value changes, not just new objects
- **Predictable Behavior** - Same values always merge the same way
- **Developer Ergonomics** - No need to manage object identity

## Future Considerations

This toy implementation omits several features needed for production:

- **Persistence** - Collections exist only in memory
- **Conflict Resolution** - Last-write-wins is too simplistic
- **Vector Clocks** - Need better causality tracking
- **Schema Migration** - No support for evolving shapes
- **Transactions** - No multi-collection atomicity
- **Indexing** - No efficient queries beyond ID lookup
- **Garbage Collection** - No cleanup of deleted items
