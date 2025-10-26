---
title: Client Collection Architecture
description: Type definitions and architecture for client-side collection with operation rebasing
---

The ClientCollection is a client-side wrapper around Collection that manages pending local operations and rebases them on top of server state. This enables optimistic UI updates while maintaining consistency with the server.

## Core Concepts

ClientCollection implements a git-like rebasing model:

1. **Server State** - The source of truth from the server (like the main branch)
2. **Pending Operations** - Local changes awaiting server confirmation (like local commits)
3. **Current View** - Server state with pending operations rebased on top (like working directory)
4. **Rebasing** - When server state updates, pending operations are reapplied on top

## Architecture Overview

The ClientCollection maintains three key components:

- **Server State Collection** - Contains only confirmed server data
- **Current View Collection** - Server state + rebased pending operations (what the user sees)
- **Pending Operations Map** - Tracks local operations awaiting confirmation

### Data Flow

```typescript
/**
 * User makes local change:
 * 1. Operation added to pending operations
 * 2. Operation applied to current view (optimistic)
 */

/**
 * Server update arrives:
 * 1. Apply server operations to server state
 * 2. Remove any matching pending operations
 * 3. Clean up old/failed pending operations
 * 4. Rebase all remaining pending operations on new server state
 */

/**
 * Server confirms operations:
 * 1. Remove operations from pending list
 * 2. Rebase remaining operations
 */
```

## Type System

### Pending Operation Tracking

```typescript
/**
 * Metadata for a pending operation
 * Tracks the operation and when it was last rebased
 */
type PendingOperation<TShape> = {
    /** The operation to apply */
    operation: DiffOperation<TShape>;

    /** When the operation was created locally (milliseconds since epoch) */
    createdAt: number;

    /** When the operation was last rebased (milliseconds since epoch) */
    lastRebaseAt: number;

    /**
     * Monotonic order time for stable sorting
     * Ensures operations maintain their order even if system clock changes
     * Auto-incremented to guarantee monotonicity
     */
    orderTime: number;
};
```

### Configuration

```typescript
/**
 * Configuration for ClientCollection behavior
 */
type ClientCollectionConfig = {
    /**
     * Maximum age of pending operations in milliseconds
     * Operations older than this are automatically removed during cleanup
     * Default: 5 minutes (300000ms)
     *
     * Rationale: Old operations likely represent stale user intent
     * or conflicts that won't resolve
     */
    maxPendingAge?: number;
};
```

## ClientCollection API

### Construction

```typescript
/**
 * Create a new client collection
 *
 * @param name - Collection name
 * @param config - Optional configuration
 */
constructor(name: string, config?: ClientCollectionConfig);
```

### Reading Data

```typescript
/**
 * Read all items from current view
 * This includes server state + rebased pending operations
 *
 * @returns Array of items (what the user should see)
 */
read(): Item<TShape>[];

/**
 * Read a specific item by ID from current view
 *
 * @returns Item if found, undefined otherwise
 */
readOne(id: ItemId): Item<TShape> | undefined;

/**
 * Read server state without pending operations
 * Useful for debugging or understanding what the server has
 *
 * @returns Array of items confirmed by server
 */
readServerState(): Item<TShape>[];
```

### Applying Changes

```typescript
/**
 * Apply server operations and rebase pending operations on top
 *
 * This is the main synchronization method. It:
 * 1. Updates server state with server operations
 * 2. Removes pending operations that match server operations (confirmed)
 * 3. Cleans up old/failed pending operations
 * 4. Rebases all remaining pending operations on new server state
 *
 * The current view is rebuilt from scratch each time:
 * current view = server state + rebased pending operations
 *
 * @param diff - Operations received from server
 * @returns Results of applying server operations
 */
applyServerUpdate(diff: Diff<TShape>): DiffResult;

/**
 * Apply a local operation (user-initiated change)
 *
 * The operation is:
 * 1. Added to pending operations list with metadata
 * 2. Applied to current view immediately (optimistic update)
 *
 * This enables instant UI feedback while waiting for server confirmation
 *
 * @param diff - Local operations to apply
 * @returns Results of applying to current view
 */
applyLocal(diff: Diff<TShape>): DiffResult;
```

### Managing Pending Operations

```typescript
/**
 * Remove operations by their IDs
 *
 * Removes operations from pending list and rebases remaining operations.
 * Use this for both server-confirmed and server-rejected operations.
 *
 * @param opIds - Operation IDs to remove
 * @returns Number of operations removed
 */
removeOperations(opIds: OperationId[]): number;

/**
 * Get all pending operations to send to server
 *
 * Returns operations sorted by creation time (oldest first).
 * This is what should be sent to the server for confirmation.
 *
 * @returns Array of pending operations
 */
getPendingOperations(): Diff<TShape>;

/**
 * Get pending operations with metadata
 *
 * Useful for debugging or displaying pending operation status to user
 *
 * @returns Array of pending operations with metadata
 */
getPendingMetadata(): PendingOperation<TShape>[];

/**
 * Get count of pending operations
 *
 * @returns Number of operations awaiting confirmation
 */
getPendingCount(): number;
```

### Utility Methods

```typescript
/**
 * Manually trigger a rebase of pending operations
 *
 * Useful for testing or debugging. Normally rebasing happens
 * automatically when server updates arrive.
 */
rebase(): void;

/**
 * Clear all pending operations
 *
 * Triggers a rebase to reset current view to match server state
 */
clearPendingOperations(): void;
```

## Monotonic Ordering

ClientCollection uses a monotonic counter to ensure operations maintain their order even if the system clock changes or goes backwards.

### How It Works

```typescript
/**
 * Monotonic ordering algorithm:
 *
 * 1. When first operation is added:
 *    - Set orderTime = Date.now()
 *    - Set maxOperationTime = orderTime
 *
 * 2. When subsequent operations are added:
 *    - Get current time = Date.now()
 *    - If current time > maxOperationTime:
 *      → Use current time as orderTime
 *      → Update maxOperationTime = current time
 *    - If current time <= maxOperationTime:
 *      → Use maxOperationTime + 1 as orderTime
 *      → Update maxOperationTime = maxOperationTime + 1
 *
 * This guarantees:
 * - Operations are always ordered by the sequence they were added
 * - No two operations have the same orderTime
 * - Clock adjustments don't break ordering
 */
```

### Benefits

- **Clock Independence**: Ordering is preserved even if system clock is adjusted
- **Deterministic**: Operations always maintain their creation order
- **Simple**: No need for vector clocks or complex causality tracking
- **Efficient**: O(1) to assign next orderTime

## Rebasing Algorithm

The core of ClientCollection is the rebasing algorithm that runs whenever server state changes.

### Rebase Process

```typescript
/**
 * Rebasing algorithm:
 *
 * 1. Reset current view to empty collection
 * 2. Clone all server state items into current view
 * 3. Sort pending operations by creation time
 * 4. Apply each pending operation in order:
 *    a. Try to apply operation to current view
 *    b. Update lastRebaseAt timestamp
 *    c. If operation fails to apply, remove it immediately
 * 5. Result: current view = server state + successfully rebased operations
 */
```

### Rebase Semantics

The rebasing behavior depends on the Last-Write-Wins (LWW) conflict resolution:

```typescript
/**
 * When a pending update operation is rebased:
 *
 * - If pending timestamp > server timestamp:
 *   → Operation succeeds, pending change takes precedence
 *
 * - If pending timestamp < server timestamp:
 *   → Operation is rejected (server is newer)
 *   → Operation is removed immediately
 *
 * - If pending timestamp === server timestamp:
 *   → If values differ: conflict resolved by updating timestamp
 *   → If values same: operation succeeds (no-op)
 *
 * - If operation fails for any reason (item not found, etc.):
 *   → Operation is removed immediately
 */
```

### Example: Concurrent Edits

```typescript
const client = new ClientCollection<TodoShape>('todos');

// Initial server state
client.applyServerUpdate([
    {
        opId: 'server-1',
        type: 'create',
        item: {
            id: 'todo-1',
            title: mutableAt('Original', 1000),
            completed: mutableAt(false, 1000),
        },
    },
]);

// User edits locally at t=2000
client.applyLocal([
    {
        opId: 'local-1',
        type: 'update',
        id: 'todo-1',
        changes: {
            title: mutableAt('Local Edit', 2000),
        },
    },
]);

// At this point:
// - Server state: title="Original" @ 1000
// - Current view: title="Local Edit" @ 2000 (pending operation applied)
// - Pending ops: [local-1]

// Server update arrives with different edit at t=1500
client.applyServerUpdate([
    {
        opId: 'server-2',
        type: 'update',
        id: 'todo-1',
        changes: {
            title: mutableAt('Server Edit', 1500),
        },
    },
]);

// After rebase:
// - Server state: title="Server Edit" @ 1500
// - Current view: title="Local Edit" @ 2000 (pending operation rebased successfully)
// - Pending ops: [local-1] (still pending because local timestamp is newer)

// When server confirms the local operation:
client.removeOperations(['local-1']);

// After removal:
// - Pending ops: [] (local-1 removed)
// - Current view matches server state
```

## Cleanup Behavior

ClientCollection automatically removes pending operations that are no longer valid:

### Immediate Removal on Rebase Failure

```typescript
/**
 * Operations are removed immediately if they fail to rebase
 *
 * Reasons for failure:
 * - Item not found (e.g., server deleted the item)
 * - Duplicate ID (e.g., server created item with same ID)
 * - Timestamp conflict (e.g., server has newer timestamp)
 *
 * Rationale:
 * - Failed operations represent irreconcilable conflicts
 * - Server state has moved on and operation no longer makes sense
 * - Avoids accumulating invalid operations
 */
```

### Age-Based Cleanup

```typescript
/**
 * Operations older than maxPendingAge are removed
 *
 * Default: 5 minutes
 *
 * Rationale:
 * - Old operations likely represent stale user intent
 * - User may have moved on to other tasks
 * - Reduces memory usage for long-running clients
 */
```

### Cleanup Timing

```typescript
/**
 * Cleanup runs at two points:
 *
 * 1. Age-based cleanup during applyServerUpdate():
 *    - After server operations are applied
 *    - Before pending operations are rebased
 *
 * 2. Immediate removal during rebasing:
 *    - When each operation fails to apply
 *    - Happens synchronously during rebase
 */
```

## Usage Patterns

### Basic Client Setup

```typescript
import { ClientCollection, createOperationId, mutable } from '@/engine';

type TodoShape = {
    title: Mutable<string>;
    completed: Mutable<boolean>;
};

// Create client collection
const todos = new ClientCollection<TodoShape>('todos', {
    maxPendingAge: 5 * 60 * 1000, // 5 minutes
    maxRebaseAttempts: 10,
});

// User creates a todo locally
const todoId = createItemId();
todos.applyLocal([
    {
        opId: createOperationId(),
        type: 'create',
        item: {
            id: todoId,
            title: mutable('Buy groceries'),
            completed: mutable(false),
        },
    },
]);

// Display to user immediately (optimistic)
const currentTodos = todos.read();
```

### Synchronization Loop

```typescript
// Periodically sync with server
async function sync() {
    // Get pending operations to send
    const pending = todos.getPendingOperations();

    if (pending.length > 0) {
        // Send to server
        const response = await sendToServer(pending);

        // Server responds with accepted/rejected operation IDs
        const acceptedIds = response.acceptedOperationIds;
        const rejectedIds = response.rejectedOperationIds;

        // Remove both accepted and rejected operations
        todos.removeOperations([...acceptedIds, ...rejectedIds]);
    }

    // Fetch and apply server updates
    const serverUpdates = await fetchFromServer();
    todos.applyServerUpdate(serverUpdates);

    // Current view now includes:
    // - All server data
    // - Rebased pending operations (that weren't removed)
}

// Run sync every 1 second
setInterval(sync, 1000);
```

### Monitoring Pending Operations

```typescript
// Monitor pending operations
const metadata = todos.getPendingMetadata();

for (const pending of metadata) {
    const age = Date.now() - pending.createdAt;
    const timeSinceRebase = Date.now() - pending.lastRebaseAt;

    // Warn user about old pending operations
    if (age > 60 * 1000) {
        console.warn(`Operation is ${age}ms old and still pending`);
    }

    // Check if operation hasn't been rebased recently
    // (might indicate network issues or server not responding)
    if (timeSinceRebase > 30 * 1000) {
        console.warn(`Operation hasn't been rebased in ${timeSinceRebase}ms`);
    }
}
```

### Displaying Pending Status

```typescript
// Show user which items have pending changes
function renderTodos() {
    const allTodos = todos.read();
    const serverTodos = todos.readServerState();
    const pending = todos.getPendingCount();

    return {
        todos: allTodos,
        hasPendingChanges: pending > 0,
        pendingCount: pending,
        serverConfirmed: serverTodos.length,
    };
}
```

## Design Rationale

### Why Rebase Instead of Merge?

Rebasing provides clearer semantics for client-side operations:

- **Predictable**: User always sees their latest changes on top
- **Intuitive**: Like git rebase, local changes stay "fresh"
- **Simple**: No need to track merge history or three-way merges
- **Efficient**: Current view is rebuilt from scratch each time

### Why Automatic Cleanup?

Automatic cleanup prevents unbounded memory growth and stale operations:

- **Memory**: Long-running clients could accumulate thousands of pending ops
- **Staleness**: Old operations likely don't reflect current user intent
- **Conflicts**: Failing operations won't magically start succeeding
- **User Experience**: Better to discard stale changes than show errors

### Why Immediate Removal?

Immediately removing failed operations provides clean semantics:

- **Simplicity**: No need to track retry counts or failure thresholds
- **Consistency**: Current view always reflects rebaseable operations
- **User Clarity**: Operations either work or are removed
- **Debugging**: Failed operations indicate actual conflicts

## Limitations and Considerations

### Current Limitations

1. **No Rollback**: Once server state updates, pending operations are rebased in-place
2. **No Conflict Resolution UI**: Failed operations are silently removed
3. **No Operation Merging**: Multiple updates to same field create multiple operations
4. **No Persistence**: Pending operations exist only in memory

### Memory Considerations

- Each pending operation stores the full operation + metadata
- For large items or many pending operations, memory usage can grow
- Cleanup helps but doesn't eliminate the problem

### Network Considerations

- Pending operations should be sent in batches for efficiency
- Server should respond with accepted/rejected operation IDs to remove from pending
- Failed network requests don't affect pending operations (they stay pending)

## Future Enhancements

Potential improvements for production use:

- **Persistence**: Store pending operations in localStorage/IndexedDB
- **Conflict Resolution UI**: Let user choose how to resolve conflicts
- **Operation Merging**: Combine multiple updates to same field
- **Undo/Redo**: Track rebase history for undo support
- **Selective Sync**: Only sync certain collections or items
- **Compression**: Compact redundant operations before sending to server
- **Persistent Ordering**: Save maxOperationTime to maintain order across restarts
