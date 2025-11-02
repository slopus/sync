---
title: Sync Engine Dual-Representation Architecture
description: Documents the dual-representation architecture with server-side (internal) and client-side (public) state representations
---

The sync engine uses two distinct representations for state: a server-side internal representation with field-level versioning for conflict resolution, and a client-side public representation with plain values for application use.

## Core Concept

The sync engine maintains state in two forms:
1. **Server Snapshot (Internal)**: Fields wrapped with version metadata for LWW conflict resolution
2. **Client State (Public)**: Plain unwrapped values derived from server snapshot + pending mutations

This separation allows the sync engine to handle out-of-order server updates correctly while providing a simple API to consumers.

## Architecture

### Server Snapshot (Internal Representation)

The server snapshot is the source of truth received from the backend. It uses field-level wrapping to enable Last-Write-Wins (LWW) conflict resolution.

#### Structure

```typescript
/**
 * Field value wrapper with version for LWW conflict resolution
 * Used internally in server snapshots
 */
interface FieldValue<T> {
    /** The actual field value */
    value: T;
    /** Version number when this field was last updated (monotonically increasing) */
    version: number;
}

/**
 * Server-side representation of an item
 * All fields are wrapped with FieldValue for conflict resolution
 * Only `id` remains unwrapped as it's the unique immutable identifier
 * When versioned is enabled, items have a `version` field for per-object versioning
 */
interface ServerItemState {
    /** Unique item identifier (unwrapped) */
    id: string;

    /** Object version (only present when versioned = true) */
    version?: number;

    /** All other fields are wrapped with FieldValue */
    // Mutable fields
    title: FieldValue<string>;
    completed: FieldValue<boolean>;

    // Immutable fields
    priority: FieldValue<number>;

    // Reference fields
    assignedTo: FieldValue<string>;

    // Local fields (client-only, still wrapped internally)
    isExpanded: FieldValue<boolean>;
}

/**
 * Complete server snapshot with per-object versioning
 * Contains wrapped field data with per-object version tracking
 * No global version - each object tracks its own version
 */
interface ServerSnapshot<T> {
    /** Collections containing server item states (wrapped fields with per-object versions) */
    [CollectionName: string]: {
        [itemId: string]: ServerItemState;
    };
}
```

#### Field Wrapping Rules

**All fields are wrapped EXCEPT:**
- `id` - unique immutable identifier

**Fields that ARE wrapped:**
- Mutable fields (e.g., `title`, `completed`)
- Immutable fields (e.g., `priority`, `category`)
- Reference fields (e.g., `assignedTo`, `createdBy`)
- Local fields (e.g., `isExpanded`, `isSelected`)

### Client State (Public Representation)

The client state is what application code works with. It provides plain unwrapped values computed by applying pending mutations on top of the merged server snapshot.

#### Structure

```typescript
/**
 * Client-side representation of an item
 * All fields are plain values (unwrapped)
 * This is computed from ServerItemState + pending mutations
 */
interface ClientItemState {
    /** Unique item identifier */
    id: string;

    /** All fields as plain values */
    title: string;
    completed: boolean;
    priority: number;
    assignedTo: string;
    isExpanded: boolean;
}

/**
 * Client state is a projection of server snapshot + mutations
 * Never persisted, always computed
 */
interface ClientState<T> {
    [CollectionName: string]: {
        [itemId: string]: ClientItemState;
    };
}
```

## Optional Version Tracking

The version tracking can be enabled/disabled per collection type using the `versioned` flag.

### Configuration

```typescript
const schema = defineSchema({
    types: {
        // With version tracking (LWW conflict resolution)
        todos: type({
            fields: {
                title: field<string>(),
                completed: field<boolean>(),
                priority: field<number>(),
            },
            versioned: true, // Enable per-object versioning and field-level LWW
        }),

        // Without version tracking (simple overwrite)
        settings: type({
            fields: {
                theme: field<string>(),
            },
            versioned: false, // Disable LWW, use simple overwrite
        }),
    }
});
```

### Behavior

**When `versioned = true` (enabled):**
- Each item has a `version` field (monotonically increasing number)
- **Version is REQUIRED** in server updates (compile-time enforced via TypeScript)
- Field `version` values match the object version
- Rebase uses LWW: compare field `version`, keep most recent value
- Handles out-of-order server snapshots correctly using version numbers

**When `versioned = false` (disabled, default):**
- No `version` field at object level
- Version is optional in server updates
- All field `version` values are set to `0`
- Rebase uses simple overwrite: incoming update always wins
- More efficient when order is guaranteed

### Compile-Time Version Requirements

The type system enforces version requirements at compile time:

```typescript
const schema = defineSchema({
    types: {
        todos: type({
            fields: { title: field<string>() },
            versioned: true, // Version tracking enabled
        }),
    }
});

const engine = sync(schema);

// ✓ Valid: version is provided
engine.rebase({
    todos: [{ id: '1', version: 1, title: 'Test' }]
});

// ✗ TypeScript Error: version is required but missing
engine.rebase({
    todos: [{ id: '1', title: 'Test' }]  // Error: Property 'version' is missing
});
```

## Conflict Resolution (LWW)

When multiple server snapshots arrive out-of-order, the sync engine uses Last-Write-Wins strategy at the field level.

### Algorithm

```typescript
// Pseudo-code for merging server snapshots with per-object versioning
function mergeServerSnapshot(
    currentSnapshot: ServerSnapshot,
    incomingUpdate: PartialServerUpdate,
    versioned: boolean
): ServerSnapshot {
    for (const item of incomingUpdate.items) {
        const existingItem = currentSnapshot[item.id];
        const incomingVersion = versioned ? item.version : 0;

        if (!existingItem) {
            // New item: add it with wrapped fields
            const newItem = {
                id: item.id,
                ...(versioned && { version: incomingVersion }),
            };

            for (const fieldName of Object.keys(item)) {
                if (fieldName === 'id' || fieldName === 'version') continue;
                newItem[fieldName] = {
                    value: item[fieldName],
                    version: incomingVersion
                };
            }

            currentSnapshot[item.id] = newItem;
        } else {
            // Existing item: merge fields using LWW
            for (const fieldName of Object.keys(item)) {
                if (fieldName === 'id' || fieldName === 'version') continue;

                const incomingField = { value: item[fieldName], version: incomingVersion };
                const existingField = existingItem[fieldName];

                if (versioned && incomingVersion > 0) {
                    // LWW: compare versions, keep most recent
                    if (incomingVersion > existingField.version) {
                        existingItem[fieldName] = incomingField;
                    }
                } else {
                    // Simple overwrite: incoming always wins
                    existingItem[fieldName] = incomingField;
                }
            }

            // Update object version if newer
            if (versioned && incomingVersion > existingItem.version) {
                existingItem.version = incomingVersion;
            }
        }
    }

    return currentSnapshot;
}
```

### Example: Out-of-Order Updates

```typescript
// Server sends update with version 1 (arrives first)
{
    todos: [{
        id: 'todo-1',
        version: 1,
        title: 'Old Title',
        completed: false
    }]
}

// Internal server state after version 1:
{
    todos: {
        'todo-1': {
            id: 'todo-1',
            version: 1,
            title: { value: 'Old Title', version: 1 },
            completed: { value: false, version: 1 }
        }
    }
}

// Server sends update with version 3 (arrives second, but is newer)
{
    todos: [{
        id: 'todo-1',
        version: 3,
        title: 'New Title',
        completed: true
    }]
}

// Internal server state after version 3:
{
    todos: {
        'todo-1': {
            id: 'todo-1',
            version: 3,
            title: { value: 'New Title', version: 3 },
            completed: { value: true, version: 3 }
        }
    }
}

// Server sends update with version 2 (arrives late, is older)
{
    todos: [{
        id: 'todo-1',
        version: 2,
        title: 'Mid Title',
        completed: false
    }]
}

// Final merged state (with versioned = true):
// Version 2 fields are rejected because version 3 is already applied
{
    todos: {
        'todo-1': {
            id: 'todo-1',
            version: 3,  // Kept version 3 (most recent)
            title: { value: 'New Title', version: 3 },  // Kept v3 (most recent)
            completed: { value: true, version: 3 }      // Kept v3 (most recent)
        }
    }
}

// Client sees (unwrapped):
{
    id: 'todo-1',
    title: 'New Title',
    completed: true
}
```

## Mutation Handling

Mutations always work with the unwrapped client state representation. They are applied on top of the merged server snapshot.

### Flow

1. **Server snapshot arrives** → Merge using LWW into internal `ServerSnapshot`
2. **Unwrap fields** → Convert `ServerSnapshot` to `ClientState` (plain values)
3. **Apply pending mutations** → Replay all mutations on `ClientState`
4. **Result** → Final `ClientState` exposed to application

### Example

```typescript
// Internal server snapshot
const serverSnapshot = {
    todos: {
        'todo-1': {
            id: 'todo-1',
            title: { value: 'Server Title', version: 100 },
            completed: { value: false, version: 100 }
        }
    }
};

// Unwrap to client state
const clientState = {
    todos: {
        'todo-1': {
            id: 'todo-1',
            title: 'Server Title',
            completed: false
        }
    }
};

// Apply pending mutation
mutator(clientState, { id: 'todo-1', completed: true });

// Final client state (what app sees)
const finalState = {
    todos: {
        'todo-1': {
            id: 'todo-1',
            title: 'Server Title',  // From server
            completed: true         // From mutation
        }
    }
};
```

## Implementation Notes

### Local Fields

Local fields are client-side only (UI state). They:
- Are wrapped with `{ value, version }` internally for consistency
- Are never sent to or received from the server
- Always initialized with default values on new items
- Can have mutations applied like any other field

### References

Reference fields (foreign keys to other collections):
- Are wrapped with `{ value, version }` like other fields
- Value is always a string (item ID) or `null` (if nullable)
- Participate in LWW conflict resolution when `versioned = true`

### Performance

The unwrapping operation (ServerSnapshot → ClientState) is performed on every rebase. This is acceptable because:
- Rebase only happens on server updates (infrequent)
- Unwrapping is a simple object traversal (skip `id` and `version`, unwrap all other fields)
- Client state is cached (only recomputed on rebase or mutation)

Per-object versioning is more efficient than global versioning because:
- Only affected objects need version comparison
- Partial updates only touch changed fields
- No need to track global snapshot order
