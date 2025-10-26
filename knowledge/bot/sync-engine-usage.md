---
title: Sync Engine Usage Patterns
description: Practical examples and usage patterns for the sync engine
---

This document provides practical examples of using the sync engine for various use cases.

## Basic Usage Pattern

### Creating a Sync Engine and Collections

```typescript
// Create a sync engine instance
const engine = new SyncEngine();

// Get or create a collection with a specific shape
type TodoShape = {
    createdAt: number;
    title: Mutable<string>;
    completed: Mutable<boolean>;
};

const todos = engine.collection<TodoShape>('todos');
```

### Creating Items

```typescript
// Create a new todo item
const todoId = createItemId();
const todo: Item<TodoShape> = {
    id: todoId,
    createdAt: Date.now(),
    title: mutable('Buy groceries'),
    completed: mutable(false),
};

// Apply the creation
todos.applyDiff([{ type: 'create', item: todo }]);
```

### Reading Items

```typescript
// Read all items
const allTodos = todos.read();

// Read specific item
const specificTodo = todos.readOne(todoId);

// Access mutable field values
if (specificTodo) {
    console.log(specificTodo.title.value);        // "Buy groceries"
    console.log(specificTodo.title.changedAt);    // timestamp
}
```

### Updating Items

```typescript
// Update a mutable field
todos.applyDiff([
    {
        type: 'update',
        id: todoId,
        changes: {
            title: mutable('Buy groceries and vegetables'),
        },
    },
]);

// Update multiple fields at once
todos.applyDiff([
    {
        type: 'update',
        id: todoId,
        changes: {
            title: mutable('Buy groceries and vegetables'),
            completed: mutable(true),
        },
    },
]);
```

### Deleting Items

```typescript
todos.applyDiff([{ type: 'delete', id: todoId }]);
```

## Change Tracking Patterns

### Subscribing to Changes

```typescript
// Subscribe to all changes
const unsubscribe = todos.onChange((diff) => {
    console.log('Changes applied:', diff);

    for (const operation of diff) {
        if (operation.type === 'create') {
            console.log('Created:', operation.item.id);
        } else if (operation.type === 'update') {
            console.log('Updated:', operation.id);
        } else if (operation.type === 'delete') {
            console.log('Deleted:', operation.id);
        }
    }
});

// Later: unsubscribe
unsubscribe();
```

### Building a Change Log

```typescript
const changeHistory: Diff<TodoShape>[] = [];

todos.onChange((diff) => {
    changeHistory.push(diff);
});

// Now every change is tracked
// Could be used for undo/redo, audit logs, etc.
```

### Reactive UI Updates

```typescript
// React-like pattern
let uiState = { todos: todos.read() };

todos.onChange(() => {
    // Re-read and update UI
    uiState = { todos: todos.read() };
    renderUI(uiState);
});
```

## Multi-Collection Patterns

### Related Collections

```typescript
const engine = new SyncEngine();

// Users collection
type UserShape = {
    name: Mutable<string>;
    email: Mutable<string>;
};
const users = engine.collection<UserShape>('users');

// Tasks collection (references users)
type TaskShape = {
    title: Mutable<string>;
    assignedTo: string;  // userId - immutable reference
    status: Mutable<'todo' | 'done'>;
};
const tasks = engine.collection<TaskShape>('tasks');

// Create user
const userId = createItemId();
users.applyDiff([
    {
        type: 'create',
        item: {
            id: userId,
            name: mutable('Alice'),
            email: mutable('alice@example.com'),
        },
    },
]);

// Create task assigned to user
const taskId = createItemId();
tasks.applyDiff([
    {
        type: 'create',
        item: {
            id: taskId,
            title: mutable('Review PR'),
            assignedTo: userId,
            status: mutable('todo'),
        },
    },
]);
```

### Cross-Collection Queries

```typescript
// Find all tasks for a specific user
function getTasksForUser(userId: string) {
    return tasks.read().filter((task) => task.assignedTo === userId);
}

// Get task with user details
function getTaskWithUser(taskId: string) {
    const task = tasks.readOne(taskId);
    if (!task) return null;

    const user = users.readOne(task.assignedTo);
    return {
        task,
        user,
    };
}
```

## Synchronization Patterns

### Applying Remote Changes

```typescript
// Receive changes from remote source
function applyRemoteChanges(remoteDiff: Diff<TodoShape>) {
    // Simply apply the diff
    const applied = todos.applyDiff(remoteDiff);

    if (applied) {
        console.log('Remote changes applied');
    }
}
```

### Generating Diffs from Changes

```typescript
// Track local changes to send to remote
const pendingChanges: Diff<TodoShape>[] = [];

todos.onChange((diff) => {
    // Queue changes to send
    pendingChanges.push(diff);
});

// Later: send to remote
async function syncToRemote() {
    if (pendingChanges.length === 0) return;

    // Flatten all pending changes
    const allChanges = pendingChanges.flat();

    await sendToRemote(allChanges);

    // Clear pending after successful send
    pendingChanges.length = 0;
}
```

### Conflict Detection

```typescript
// Detect if a field changed since last sync
function hasFieldChanged(
    itemId: string,
    fieldName: keyof TodoShape,
    sinceTimestamp: Timestamp
): boolean {
    const item = todos.readOne(itemId);
    if (!item) return false;

    const field = item[fieldName];

    // Check if it's a mutable field
    if (
        typeof field === 'object' &&
        field !== null &&
        'changedAt' in field
    ) {
        return field.changedAt > sinceTimestamp;
    }

    return false;
}
```

## Mutable Field Helper Patterns

### Conditional Updates

```typescript
// Only update if value actually changed
function updateTodoTitle(todoId: string, newTitle: string) {
    const todo = todos.readOne(todoId);
    if (!todo) return;

    // Use helper to avoid unnecessary updates
    const updatedTitle = updateMutable(todo.title, newTitle);

    // Only apply if changed (updateMutable returns same reference if unchanged)
    if (updatedTitle !== todo.title) {
        todos.applyDiff([
            {
                type: 'update',
                id: todoId,
                changes: { title: updatedTitle },
            },
        ]);
    }
}
```

### Nullable Field Patterns

```typescript
// Working with nullable mutable fields
type NoteShape = {
    content: Mutable<string>;
    tags: Mutable<string[] | null>;
};

const notes = engine.collection<NoteShape>('notes');

// Create note without tags
const noteId = createItemId();
notes.applyDiff([
    {
        type: 'create',
        item: {
            id: noteId,
            content: mutable('My note'),
            tags: mutable(null),
        },
    },
]);

// Later: add tags
notes.applyDiff([
    {
        type: 'update',
        id: noteId,
        changes: {
            tags: mutable(['important', 'work']),
        },
    },
]);

// Clear tags
notes.applyDiff([
    {
        type: 'update',
        id: noteId,
        changes: {
            tags: mutable(null),
        },
    },
]);
```

## Advanced Patterns

### Batch Operations

```typescript
// Apply multiple operations atomically
function createMultipleTodos(titles: string[]) {
    const operations: Diff<TodoShape> = titles.map((title) => ({
        type: 'create',
        item: {
            id: createItemId(),
            createdAt: Date.now(),
            title: mutable(title),
            completed: mutable(false),
        },
    }));

    todos.applyDiff(operations);
}
```

### Computed Fields

```typescript
// Derive information from collections
function getTodoStats() {
    const allTodos = todos.read();

    return {
        total: allTodos.length,
        completed: allTodos.filter((t) => t.completed.value).length,
        pending: allTodos.filter((t) => !t.completed.value).length,
    };
}

// Keep stats updated
let stats = getTodoStats();
todos.onChange(() => {
    stats = getTodoStats();
    console.log('Stats updated:', stats);
});
```

### Migration Pattern

```typescript
// Evolve data structure over time
type TodoV1Shape = {
    title: Mutable<string>;
    done: Mutable<boolean>;
};

type TodoV2Shape = {
    title: Mutable<string>;
    status: Mutable<'todo' | 'in-progress' | 'done'>;
};

function migrateToV2() {
    const v1Todos = engine.collection<TodoV1Shape>('todos');
    const v2Todos = engine.collection<TodoV2Shape>('todos_v2');

    for (const todo of v1Todos.read()) {
        v2Todos.applyDiff([
            {
                type: 'create',
                item: {
                    id: todo.id,
                    title: todo.title,
                    status: mutable(todo.done.value ? 'done' : 'todo'),
                },
            },
        ]);
    }

    // Remove old collection
    engine.removeCollection('todos');
}
```

### Undo/Redo Implementation

```typescript
type HistoryEntry = {
    forward: Diff<TodoShape>;
    backward: Diff<TodoShape>;
};

const history: HistoryEntry[] = [];
let historyIndex = -1;

// Track changes with reverse operations
todos.onChange((diff) => {
    // Generate reverse operations
    const backward: Diff<TodoShape> = diff.map((op) => {
        if (op.type === 'create') {
            return { type: 'delete', id: op.item.id };
        } else if (op.type === 'delete') {
            // Would need to store deleted items to support redo
            throw new Error('Delete undo not implemented');
        } else {
            // Would need to store previous values
            throw new Error('Update undo not implemented');
        }
    });

    // Add to history
    history.length = historyIndex + 1;
    history.push({ forward: diff, backward });
    historyIndex++;
});

function undo() {
    if (historyIndex < 0) return;

    const entry = history[historyIndex];
    todos.applyDiff(entry.backward);
    historyIndex--;
}

function redo() {
    if (historyIndex >= history.length - 1) return;

    historyIndex++;
    const entry = history[historyIndex];
    todos.applyDiff(entry.forward);
}
```

## Testing Patterns

### Deterministic Testing

```typescript
// Create test fixtures
function createTestTodo(id: string, title: string): Item<TodoShape> {
    return {
        id,
        createdAt: 0,
        title: mutable(title),
        completed: mutable(false),
    };
}

// Test with fixed IDs
const testTodo = createTestTodo('test-id-1', 'Test Todo');
todos.applyDiff([{ type: 'create', item: testTodo }]);
```

### Spy on Changes

```typescript
// Track what changed
const changeSpy = vi.fn();
todos.onChange(changeSpy);

// Perform operations
todos.applyDiff([{ type: 'create', item: testTodo }]);

// Assert
expect(changeSpy).toHaveBeenCalledTimes(1);
expect(changeSpy).toHaveBeenCalledWith([
    { type: 'create', item: testTodo },
]);
```

## Performance Considerations

### Efficient Updates

```typescript
// Good: single diff with multiple operations
todos.applyDiff([
    { type: 'update', id: id1, changes: { completed: mutable(true) } },
    { type: 'update', id: id2, changes: { completed: mutable(true) } },
    { type: 'update', id: id3, changes: { completed: mutable(true) } },
]);

// Bad: multiple diffs (more listener calls)
todos.applyDiff([{ type: 'update', id: id1, changes: { completed: mutable(true) } }]);
todos.applyDiff([{ type: 'update', id: id2, changes: { completed: mutable(true) } }]);
todos.applyDiff([{ type: 'update', id: id3, changes: { completed: mutable(true) } }]);
```

### Minimize Re-renders

```typescript
// Debounce UI updates
let updateTimeout: NodeJS.Timeout | null = null;

todos.onChange(() => {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
        renderUI(todos.read());
        updateTimeout = null;
    }, 16); // ~60fps
});
```
