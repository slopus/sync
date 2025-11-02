# @slopus/sync

A TypeScript-first sync engine with local fields, versioned rebases, and Immer-based state management for building real-time collaborative applications.

## Features

- **Type-Safe Schema Definition** - Define your data model with full TypeScript inference
- **Local Fields** - Client-only fields that never sync to the server (perfect for UI state like `isExpanded`, `isSelected`)
- **Versioned Rebases** - Last-Write-Wins (LWW) conflict resolution with automatic version tracking
- **Optimistic Updates** - Apply mutations immediately, rebase when server state changes
- **Direct Mutations** - Apply mutations without queueing for local-only state changes
- **Immer Integration** - Immutable state updates with mutable-style API
- **Direct Rebase Mode** - Patch both server and client state directly without reapplying mutations
- **Zero Dependencies** - Only requires `immer` and `@paralleldrive/cuid2`

## Installation

```bash
yarn add @slopus/sync
```

## Quick Start

### 1. Define Your Schema

Define your schema with full TypeScript autocomplete and type checking using the chainable `.withMutations()` API:

```typescript
import { defineSchema, type, field, localField, reference, mutation, syncEngine } from '@slopus/sync';
import { createId } from '@paralleldrive/cuid2';

// Define schema with types, then chain mutations for full type safety
const schema = defineSchema({
    todos: type({
        fields: {
            title: field<string>(),
            completed: field<boolean>(),
            assignedTo: reference('users', true), // nullable reference
            isExpanded: localField(false), // client-only UI state
        },
    }),
    users: type({
        fields: {
            name: field<string>(),
            email: field<string>(),
        },
    }),
}).withMutations({
    createTodo: mutation((draft, input: { title: string; assignedTo: string | null }) => {
        // ✨ draft.todos has full autocomplete here!
        const id = createId();
        draft.todos[id] = {
            id,
            title: input.title,
            completed: false,
            assignedTo: input.assignedTo,
            isExpanded: false,
        };
    }),
    toggleTodo: mutation((draft, input: { id: string }) => {
        // ✨ TypeScript will catch typos like draft.todoss[input.id]
        if (draft.todos[input.id]) {
            draft.todos[input.id].completed = !draft.todos[input.id].completed;
        }
    }),
});

// You can also chain multiple .withMutations() calls:
const extendedSchema = schema.withMutations({
    deleteTodo: mutation((draft, input: { id: string }) => {
        delete draft.todos[input.id];
    }),
});
```

### 2. Create Sync Engine

```typescript
import { syncEngine } from '@slopus/sync';

// For schemas with only collections, objects is optional
const engine = syncEngine(schema, { from: 'new' });

// Mutation handlers are already registered from the schema!
// No need to call addMutator() - they're defined inline with mutations
```

### 3. Use the Engine

```typescript
// Initial sync from server
engine.rebase({
    todos: [
        { id: 'todo-1', title: 'Buy milk', completed: false, assignedTo: null },
    ],
    users: [
        { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    ],
});

// Apply local mutation (optimistic update - will be sent to server)
engine.mutate('toggleTodo', { id: 'todo-1' });

// Access current state
console.log(engine.state.todos['todo-1'].completed); // true
console.log(engine.pendingMutations.length); // 1

// Apply direct mutation (local-only, not queued)
engine.mutate('toggleTodo', { id: 'todo-1' }, { direct: true });
console.log(engine.state.todos['todo-1'].completed); // false
console.log(engine.pendingMutations.length); // Still 1 (direct mutations don't queue)

// Server confirms the mutation
engine.rebase({
    todos: [
        { id: 'todo-1', completed: true }, // partial update
    ],
});

// Commit the pending mutation
const mutationId = engine.pendingMutations[0].id;
engine.commit(mutationId);

console.log(engine.pendingMutations); // []
```

## Core Concepts

### Schema Definition

Use the schema DSL to define collections and singletons:

```typescript
const schema = defineSchema({
    // Collection (multiple items with IDs)
    posts: type({
        fields: {
            title: field<string>(),
            content: field<string>(),
        },
    }),

    // Singleton object (single instance, no ID)
    settings: object({
        fields: {
            theme: field<'light' | 'dark'>(),
            notifications: field<boolean>(),
        },
    }),
}).withMutations({
    // Define mutations with handler functions
    updateTheme: mutation((draft, input: { theme: 'light' | 'dark' }) => {
        draft.settings.theme = input.theme;
    }),
});

// Singleton objects require initial values
const engine = syncEngine(schema, {
    from: 'new',
    objects: {
        settings: {
            theme: 'light',
            notifications: true,
        },
        // Collections (like 'posts') are not included - they start empty
    },
});

// Access singleton directly (no ID indexing)
console.log(engine.state.settings.theme); // 'light'

// Access collection with ID
console.log(engine.state.posts['post-1']); // undefined (empty)
```

### Field Types

- **`field<T>()`** - Regular synced field
- **`localField<T>(defaultValue)`** - Client-only field (not synced)
- **`reference(collection, nullable)`** - Reference to another item

### Local Fields

Local fields are perfect for UI state that should never leave the client:

```typescript
const schema = defineSchema({
    items: type({
        fields: {
            name: field<string>(),
            isExpanded: localField(false), // ← never synced
            isSelected: localField(false),
        },
    }),
}).withMutations({
    toggleExpanded: mutation((draft, input: { id: string }) => {
        if (draft.items[input.id]) {
            draft.items[input.id].isExpanded = !draft.items[input.id].isExpanded;
        }
    }),
});

const engine = syncEngine(schema, { from: 'new' }); // Collections only, objects optional

// Server updates ignore local fields
engine.rebase({
    items: [
        { id: 'item-1', name: 'Updated', isExpanded: true }, // isExpanded ignored
    ],
});

// Use allowLocalFields: true to update them
engine.rebase({
    items: [
        { id: 'item-1', isExpanded: true },
    ],
}, { allowLocalFields: true });
```

### Direct Mutations

Apply mutations directly to client state without adding them to the pending queue. This is perfect for local-only state changes that don't need server confirmation:

```typescript
const schema = defineSchema({
    todos: type({
        fields: {
            title: field<string>(),
            completed: field<boolean>(),
            isExpanded: localField(false),
        },
    }),
}).withMutations({
    createTodo: mutation((draft, input: { title: string }) => {
        const id = createId();
        draft.todos[id] = {
            id,
            title: input.title,
            completed: false,
            isExpanded: false,
        };
    }),
    toggleExpanded: mutation((draft, input: { id: string }) => {
        if (draft.todos[input.id]) {
            draft.todos[input.id].isExpanded = !draft.todos[input.id].isExpanded;
        }
    }),
});

const engine = syncEngine(schema, { from: 'new' });

// Normal mutation - adds to pending queue (will be sent to server)
engine.mutate('createTodo', { title: 'Buy milk' });
console.log(engine.pendingMutations.length); // 1

// Direct mutation - applies immediately without queueing
engine.mutate('toggleExpanded', { id: 'todo-1' }, { direct: true });
console.log(engine.pendingMutations.length); // Still 1

// State is updated immediately
console.log(engine.state.todos['todo-1'].isExpanded); // true

// Server state remains unchanged
console.log(engine.serverState.todos['todo-1']); // undefined (direct mutations don't affect server state)
```

**When to use direct mutations:**
- Local-only UI state changes (expand/collapse, selection, etc.)
- Temporary state that shouldn't be synced
- Client-side interactions that don't need server confirmation

**Key differences from normal mutations:**
- Not added to `pendingMutations` queue
- Not sent to the server
- Don't affect `serverState`
- Applied directly to `state` only

### Rebase Options

Control how `rebase()` updates state:

```typescript
interface RebaseOptions {
    allowServerFields?: boolean; // Allow updating synced fields (default: true)
    allowLocalFields?: boolean;  // Allow updating local fields (default: false)
    direct?: boolean;            // Patch both states directly without reapplying mutations (default: false)
}
```

### Versioned Rebases

Enable automatic Last-Write-Wins conflict resolution:

```typescript
const schema = defineSchema({
    docs: type({
        fields: {
            content: field<string>(),
        },
        versioned: true, // ← enables $version tracking
    }),
}).withMutations({
    updateContent: mutation((draft, input: { id: string; content: string }) => {
        if (draft.docs[input.id]) {
            draft.docs[input.id].content = input.content;
        }
    }),
});

const engine = syncEngine(schema, { from: 'new' }); // Collections only

// Server sends updates with $version
engine.rebase({
    docs: [
        { id: 'doc-1', content: 'v2', $version: 2 },
    ],
});
```

### Type Inference

Full TypeScript inference for all operations:

```typescript
import type {
    InferCreate,
    InferUpdate,
    InferItemState,
    InferMutationInput
} from '@slopus/sync';

type CreateTodo = InferCreate<typeof schema, 'todos'>;
// { id: string; title: string; completed: boolean; assignedTo: string | null }

type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
// { id: string; title?: string; completed?: boolean; assignedTo?: string | null; isExpanded?: boolean }

type TodoState = InferItemState<typeof schema, 'todos'>;
// { id: string; title: string; completed: boolean; assignedTo: string | null; isExpanded: boolean }

type ToggleTodoInput = InferMutationInput<typeof schema, 'toggleTodo'>;
// { id: string }
```

## API Reference

### Schema DSL

- `defineSchema(types)` - Define schema with type definitions (collections and singleton objects)
  - Returns a schema with empty mutations and chainable `.withMutations()` method
  - Provides full TypeScript autocomplete in mutation handlers
  - Chain `.withMutations()` to add fully-typed mutations
  - Can chain multiple `.withMutations()` calls to progressively add mutations
- `type(options)` - Define a collection type
- `object(options)` - Define a singleton object type
- `field<T>()` - Define a synced field
- `localField<T>(defaultValue)` - Define a local-only field
- `reference(collection, nullable)` - Define a reference field
- `mutation(handler)` - Define a mutation with a handler function (input type inferred from parameter)
- `.withMutations(mutations)` - Add mutations to a schema (chainable, throws error on duplicate names)

### Sync Engine

- `syncEngine(schema, init)` - Create a new sync engine instance
  - `init`: Initialization parameter
    - `{ from: 'new', objects?: {...} }` - Start with fresh state (objects optional if no singletons)
    - `{ from: 'restore', data: string }` - Restore from persisted state
- `engine.rebase(update, options?)` - Apply server updates
  - `options`: Rebase options
    - `allowServerFields?: boolean` - Allow updating synced fields (default: true)
    - `allowLocalFields?: boolean` - Allow updating local fields (default: false)
    - `direct?: boolean` - Patch both states directly without reapplying mutations (default: false)
- `engine.mutate(name, input, options?)` - Apply optimistic mutation (handler must be defined in schema)
  - `options`: Mutation options
    - `direct?: boolean` - Apply directly without queueing (default: false)
- `engine.commit(mutationIds)` - Mark mutations as confirmed by server
- `engine.persist()` - Serialize state for persistence (returns string)
- `engine.state` - Current client state (with mutations applied)
- `engine.serverState` - Server snapshot (before mutations)
- `engine.pendingMutations` - Array of unconfirmed mutations

### Update Types

- `PartialUpdate<T>` - Partial update with all field types
- `PartialServerUpdate<T>` - Partial update with only synced fields
- `PartialLocalUpdate<T>` - Partial update with only local fields
- `FullUpdate<T>` - Full update with all fields required
- `FullServerUpdate<T>` - Full update with only synced fields required
- `FullLocalUpdate<T>` - Full update with only local fields required

## TypeScript Support

This library is written in TypeScript and provides extensive type inference. All types are automatically inferred from your schema definition, giving you full autocomplete and type checking throughout your application.

## License

MIT © [Steve Korshakov](https://github.com/slopus)

## Repository

[https://github.com/slopus/sync](https://github.com/slopus/sync)
