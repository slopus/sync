---
title: Sync Engine Constraints and Guarantees
description: Additional constraints and guarantees added to the sync engine for distributed synchronization
---

This document describes the enhanced constraints that make the sync engine suitable for distributed synchronization scenarios.

## Overview of Enhanced Constraints

The sync engine has been enhanced with four critical constraints:

1. **Operation IDs**: Every diff operation must have a unique identifier for tracking
2. **Timestamp Clamping**: Timestamps cannot be in the future (clamped to "now")
3. **Operation Independence**: Operations can arrive in any order and are processed independently
4. **Explicit Results**: Each operation returns explicit acceptance/rejection with reasons

## Constraint 1: Operation IDs

### Requirement

Every diff operation must have a unique `opId` field for tracking and auditing.

### Type Definition

```typescript
/**
 * Unique identifier for a diff operation
 * Generated using CUID2 for collision resistance
 */
type OperationId = string;

/**
 * All operations include an opId field
 */
type DiffOperation<TShape> =
    | { opId: OperationId; type: 'create'; item: Item<TShape> }
    | { opId: OperationId; type: 'update'; id: ItemId; changes: Partial<TShape> }
    | { opId: OperationId; type: 'delete'; id: ItemId };
```

### Purpose

- **Idempotency**: Same operation can be retried safely
- **Tracking**: Know which specific operations succeeded or failed
- **Auditing**: Maintain history of what operations were attempted
- **Debugging**: Trace specific operations through the system

### Usage

```typescript
import { createOperationId } from './sync-engine';

// Create operations with unique IDs
const opId1 = createOperationId();
const opId2 = createOperationId();

collection.applyDiff([
    {
        opId: opId1,
        type: 'create',
        item: { id: createItemId(), title: mutable('Task') },
    },
    {
        opId: opId2,
        type: 'update',
        id: itemId,
        changes: { title: mutable('Updated') },
    },
]);
```

## Constraint 2: Timestamp Clamping

### Requirement

The `changedAt` timestamp in mutable fields **must not be in the future**. All timestamps are clamped to the current time ("now") when the diff is applied.

### Behavior

When a diff operation contains mutable fields with timestamps in the future:

1. The timestamp is automatically clamped to `Date.now()` at application time
2. The operation proceeds with the clamped timestamp
3. No error is raised - clamping is transparent

### Rationale

- **Clock Skew**: Prevents issues from system clock differences
- **Causality**: Maintains causal ordering of events
- **Security**: Prevents malicious future timestamps
- **Correctness**: Ensures timestamps represent real past events

### Example

```typescript
const futureTime = Date.now() + 10000; // 10 seconds in future

const opId = createOperationId();
collection.applyDiff([
    {
        opId,
        type: 'create',
        item: {
            id: createItemId(),
            // This timestamp is in the future
            title: mutableAt('Test', futureTime),
        },
    },
]);

const item = collection.readOne(itemId);
// Timestamp has been clamped to now (not in future)
expect(item.title.changedAt).toBeLessThanOrEqual(Date.now());
expect(item.title.changedAt).toBeLessThan(futureTime);
```

### Implementation Detail

Clamping happens in `validateAndClampItem` and `validateAndClampChanges` before the merge logic runs. The "now" timestamp is captured once per `applyDiff` call, ensuring consistency across all operations in a single batch.

## Constraint 3: Operation Independence

### Requirement

Operations within a diff can arrive in any order. Each operation is processed independently based on its timestamps, not its position in the array.

### Last-Write-Wins (LWW) Conflict Resolution

The sync engine uses Last-Write-Wins strategy based on `changedAt` timestamps:

```typescript
/**
 * LWW Resolution Rules:
 *
 * 1. If incoming.changedAt > existing.changedAt:
 *    → Accept: Use incoming value and timestamp
 *
 * 2. If incoming.changedAt < existing.changedAt:
 *    → Reject: Keep existing value and timestamp
 *
 * 3. If incoming.changedAt === existing.changedAt:
 *    → Conflict: Use incoming value but update timestamp to now
 */
```

### Out-of-Order Processing

Operations are processed sequentially but independently:

```typescript
const t0 = 1000;
const t1 = 2000;
const t2 = 3000;
const t3 = 4000;

// Create item at t0
collection.applyDiff([
    { opId: op0, type: 'create', item: { id, title: mutableAt('Initial', t0) } },
]);

// Apply updates in shuffled order
collection.applyDiff([
    { opId: op2, type: 'update', id, changes: { title: mutableAt('Middle', t2) } },  // ✅ Accepted (t2 > t0)
    { opId: op1, type: 'update', id, changes: { title: mutableAt('Old', t1) } },     // ❌ Rejected (t1 < t2)
    { opId: op3, type: 'update', id, changes: { title: mutableAt('Newest', t3) } },  // ✅ Accepted (t3 > t2)
]);

// Final state has t3 (the newest timestamp)
const item = collection.readOne(id);
expect(item.title.value).toBe('Newest');
expect(item.title.changedAt).toBe(t3);
```

### Guarantees

- **Deterministic**: Same set of operations yields same final state regardless of order
- **Convergent**: Multiple replicas converge to same state when they see all operations
- **Monotonic**: Once a timestamp is seen, older timestamps cannot overwrite it

### Non-Guarantees

- **No Causality Tracking**: LWW doesn't track happens-before relationships
- **No Concurrent Conflict Detection**: Same timestamp conflicts are resolved arbitrarily
- **No Operation Reordering**: Operations are processed in array order, but timestamps determine outcome

## Constraint 4: Explicit Results

### Requirement

The `applyDiff` method returns a `DiffResult` that maps each operation ID to its result (accepted/rejected with optional reason).

### Type Definition

```typescript
/**
 * Result of applying a single operation
 */
type OperationResult = {
    accepted: boolean;
    reason?: string;  // Present when accepted=false
};

/**
 * Map from operation IDs to their results
 */
type DiffResult = Map<OperationId, OperationResult>;
```

### Usage

```typescript
const opId1 = createOperationId();
const opId2 = createOperationId();

const results = collection.applyDiff([
    { opId: opId1, type: 'create', item: { id, title: mutable('Test') } },
    { opId: opId2, type: 'create', item: { id, title: mutable('Duplicate') } }, // Same ID
]);

// Check individual results
if (results.get(opId1)?.accepted) {
    console.log('Operation 1 succeeded');
}

if (!results.get(opId2)?.accepted) {
    const reason = results.get(opId2)?.reason;
    console.log(`Operation 2 failed: ${reason}`);
    // Logs: "Operation 2 failed: Item with this ID already exists"
}
```

### Rejection Reasons

Common rejection reasons include:

- **Create Operations**:
  - `"Item with this ID already exists"` - Item ID conflict

- **Update Operations**:
  - `"Item not found"` - Target item doesn't exist
  - `"No changes to apply"` - All changes rejected (e.g., older timestamps)

- **Delete Operations**:
  - `"Item not found"` - Target item doesn't exist

### Helper Functions

```typescript
// Check if operation was accepted
function isAccepted(results: DiffResult, opId: string): boolean {
    return results.get(opId)?.accepted === true;
}

// Get rejection reason
function getReason(results: DiffResult, opId: string): string | undefined {
    return results.get(opId)?.reason;
}
```

### Change Notifications

Only **accepted** operations trigger change listeners. Rejected operations do not notify listeners.

```typescript
const acceptedOps: Diff<TShape>[] = [];

collection.onChange((diff) => {
    acceptedOps.push(diff);
});

// Apply mix of valid and invalid operations
collection.applyDiff([
    { opId: op1, type: 'create', item: validItem },      // ✅ Notified
    { opId: op2, type: 'create', item: duplicateItem },  // ❌ Not notified
]);

// acceptedOps contains only op1
```

## Working with Explicit Timestamps

### Helper: mutableAt

For precise timestamp control, use `mutableAt` instead of `mutable`:

```typescript
/**
 * Create mutable field with current time
 */
const field1 = mutable('value');  // changedAt = Date.now()

/**
 * Create mutable field with explicit timestamp
 * Useful for:
 * - Reconstructing from storage
 * - Testing with fixed timestamps
 * - Synchronizing from remote source
 */
const field2 = mutableAt('value', 1234567890);  // changedAt = 1234567890
```

### Best Practices

1. **Local Changes**: Use `mutable()` for local user-initiated changes
2. **Remote Changes**: Use `mutableAt()` when applying changes from network
3. **Testing**: Use `mutableAt()` with fixed timestamps for deterministic tests
4. **Storage**: Use `mutableAt()` when reconstructing from database

## Implications for Distributed Systems

These constraints enable several distributed system patterns:

### Event Sourcing

```typescript
// Store operations as events
const eventLog: Diff<TShape> = [];

collection.onChange((diff) => {
    eventLog.push(...diff);
    // Persist to storage
    saveEvents(diff);
});

// Replay events to reconstruct state
const newCollection = new Collection<TShape>('replayed');
newCollection.applyDiff(eventLog);
```

### Optimistic UI

```typescript
// Apply change optimistically
const opId = createOperationId();
collection.applyDiff([{
    opId,
    type: 'update',
    id: itemId,
    changes: { status: mutable('saving') },
}]);

// Send to server
try {
    await syncToServer(opId);
} catch (error) {
    // Rollback on failure
    collection.applyDiff([{
        opId: createOperationId(),
        type: 'update',
        id: itemId,
        changes: { status: mutable('error') },
    }]);
}
```

### Offline-First

```typescript
// Queue operations while offline
const pendingOps: Diff<TShape> = [];

collection.onChange((diff) => {
    if (!navigator.onLine) {
        pendingOps.push(...diff);
    }
});

// Sync when back online
window.addEventListener('online', async () => {
    const results = await syncOperations(pendingOps);

    // Handle conflicts
    for (const [opId, result] of results.entries()) {
        if (!result.accepted) {
            console.log(`Conflict for ${opId}: ${result.reason}`);
        }
    }
});
```

### Multi-Master Replication

```typescript
// Receive operations from another replica
function applyRemoteOps(remoteOps: Diff<TShape>): void {
    const results = collection.applyDiff(remoteOps);

    // All operations converge due to LWW
    // No special conflict resolution needed

    // Track which remote ops were applied
    const appliedCount = Array.from(results.values())
        .filter(r => r.accepted)
        .length;

    console.log(`Applied ${appliedCount} of ${remoteOps.length} remote operations`);
}
```

## Performance Considerations

### Batch Operations

Operations in a single `applyDiff` call are processed in one batch:

```typescript
// Good: Single batch, one listener notification
const results = collection.applyDiff([op1, op2, op3]);

// Bad: Three separate batches, three notifications
collection.applyDiff([op1]);
collection.applyDiff([op2]);
collection.applyDiff([op3]);
```

### Operation Validation

Each operation is validated independently:
- Timestamp clamping: O(fields) per operation
- Merge logic: O(fields) per operation
- State lookup: O(1) per operation (Map-based)

Total: O(operations × fields) complexity

### Memory Usage

- `DiffResult` allocates one entry per operation
- Accepted operations are stored in memory for listener notification
- Rejected operations are immediately discarded after result recording

## Limitations and Future Work

### Current Limitations

1. **No Vector Clocks**: Can't detect true concurrent conflicts
2. **No Tombstones**: Deleted items are immediately removed (no sync history)
3. **No Operation Log**: Past operations aren't persisted
4. **No Partial Replication**: All items in a collection are kept
5. **No Compaction**: No mechanism to compact operation history

### Future Enhancements

- **Hybrid Logical Clocks**: Better causality tracking
- **CRDT Support**: Commutative operations for certain field types
- **Operation Log**: Persistent history for debugging and replay
- **Selective Sync**: Filter which items to replicate
- **Compression**: Compact repetitive operations

## Summary

The four enhanced constraints transform the sync engine from a simple in-memory store to a foundation for distributed synchronization:

1. **Operation IDs** enable tracking and idempotency
2. **Timestamp Clamping** prevents future timestamps and clock skew issues
3. **Operation Independence** allows out-of-order delivery and convergence
4. **Explicit Results** provide clear feedback on what succeeded or failed

These constraints work together to provide:
- ✅ **Deterministic** conflict resolution
- ✅ **Convergent** replication across nodes
- ✅ **Idempotent** operation retry
- ✅ **Transparent** timestamp sanitization
- ✅ **Explicit** success/failure tracking
