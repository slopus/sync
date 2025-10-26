---
title: Schema DSL for Collection Types
description: Runtime schema definition system with TypeScript type inference
---

The Schema DSL provides a declarative way to define collection schemas with automatic type inference for all representations. It's a standalone system separate from the Collection/ClientCollection implementations.

## Overview

The schema DSL enables you to define collection schemas at runtime while providing full TypeScript type safety. Each collection definition automatically infers four different type representations:

1. **CreateInput** - For inserting new records
2. **UpdateInput** - For updating existing records
3. **Item** - For in-memory representation
4. **Denormalized** - For server/database storage

## Core Concepts

### Field Types

There are two types of fields:

- **Mutable Fields**: Track when they were last changed
  - In-memory: `{ value: T, changedAt: number }`
  - Denormalized: Two flat fields (`field: T`, `fieldChangedAt: number`)
  - Can be updated

- **Immutable Fields**: Set once and never change
  - In-memory: Plain value `T`
  - Denormalized: Single field (`field: T`)
  - Cannot be updated

### Automatic Fields

Every collection automatically includes:
- `id: string` - Unique identifier (not in create input)
- `createdAt: number` - Creation timestamp (not in create input, immutable)

## Type System

### Field Descriptors

Field descriptors carry both runtime and compile-time type information.

```typescript
/**
 * Field descriptor interface
 */
type FieldDescriptor<T> = {
    readonly fieldType: 'mutable' | 'immutable';
    readonly __type?: T; // Phantom type for TypeScript
};

/**
 * Create a mutable field descriptor
 */
function mutableField<T>(): FieldDescriptor<T>;

/**
 * Create an immutable field descriptor
 */
function immutableField<T>(): FieldDescriptor<T>;
```

### Schema Definition

```typescript
/**
 * Schema for a single collection
 */
type CollectionSchema = {
    [fieldName: string]: FieldDescriptor;
};

/**
 * Complete schema definition
 */
type SchemaDefinition = {
    [collectionName: string]: CollectionSchema;
};

/**
 * Define a schema
 */
function defineSchema<T extends SchemaDefinition>(schema: T): Schema<T>;
```

## Type Inference

### InferCreate

Extracts the create input type for a collection.

```typescript
/**
 * Create input type
 *
 * Includes:
 * - All user-defined fields (no id, no createdAt)
 * - Mutable fields as plain values
 * - Immutable fields as plain values
 */
type InferCreate<TSchema, TCollection>;
```

**Example:**
```typescript
const schema = defineSchema({
    todos: {
        title: mutableField<string>(),
        completed: mutableField<boolean>(),
        priority: immutableField<number>(),
    }
});

type CreateTodo = InferCreate<typeof schema, 'todos'>;
// {
//   title: string;
//   completed: boolean;
//   priority: number;
// }
```

### InferUpdate

Extracts the update input type for a collection.

```typescript
/**
 * Update input type
 *
 * Includes:
 * - Only mutable fields (immutable cannot be updated)
 * - All fields are optional
 * - Plain values (not wrapped)
 */
type InferUpdate<TSchema, TCollection>;
```

**Example:**
```typescript
type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
// {
//   title?: string;
//   completed?: boolean;
// }
// Note: priority is not included (immutable)
```

### InferItem

Extracts the in-memory item type for a collection.

```typescript
/**
 * In-memory item type
 *
 * Includes:
 * - id: string (auto-added)
 * - createdAt: number (auto-added immutable)
 * - Mutable fields: { value: T, changedAt: number }
 * - Immutable fields: plain value
 */
type InferItem<TSchema, TCollection>;
```

**Example:**
```typescript
type Todo = InferItem<typeof schema, 'todos'>;
// {
//   id: string;
//   createdAt: number;
//   title: { value: string; changedAt: number };
//   completed: { value: boolean; changedAt: number };
//   priority: number;
// }
```

### InferDenormalized

Extracts the denormalized (database) type for a collection.

```typescript
/**
 * Denormalized (database) type
 *
 * Includes:
 * - id: string (auto-added)
 * - createdAt: number (auto-added immutable)
 * - Mutable fields: two flat fields (value + changedAt)
 * - Immutable fields: single field
 */
type InferDenormalized<TSchema, TCollection>;
```

**Example:**
```typescript
type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;
// {
//   id: string;
//   createdAt: number;
//   title: string;
//   titleChangedAt: number;
//   completed: boolean;
//   completedChangedAt: number;
//   priority: number;
// }
```

## Usage Examples

### Basic Schema Definition

```typescript
import {
    defineSchema,
    mutableField,
    immutableField,
    type InferCreate,
    type InferUpdate,
    type InferItem,
    type InferDenormalized,
} from '@/engine';

// Define schema
const schema = defineSchema({
    todos: {
        title: mutableField<string>(),
        completed: mutableField<boolean>(),
        priority: immutableField<number>(),
    },
    users: {
        name: mutableField<string>(),
        email: mutableField<string>(),
        role: immutableField<'admin' | 'user'>(),
    },
});

// Extract types
type CreateTodo = InferCreate<typeof schema, 'todos'>;
type UpdateTodo = InferUpdate<typeof schema, 'todos'>;
type Todo = InferItem<typeof schema, 'todos'>;
type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;
```

### Creating Records

```typescript
// Type-safe creation
const newTodo: CreateTodo = {
    title: 'Buy groceries',
    completed: false,
    priority: 1,
};

// ❌ Compile error - id not allowed in create
const invalid: CreateTodo = {
    id: '123',
    title: 'Test',
    completed: false,
    priority: 1,
};
```

### Updating Records

```typescript
// Type-safe update (only mutable fields)
const update: UpdateTodo = {
    title: 'Buy groceries and vegetables',
    completed: true,
};

// Partial updates allowed
const partialUpdate: UpdateTodo = {
    completed: true,
};

// ❌ Compile error - priority is immutable
const invalid: UpdateTodo = {
    priority: 2,
};
```

### Working with Items

```typescript
// In-memory representation
const todo: Todo = {
    id: '123',
    createdAt: Date.now(),
    title: { value: 'Buy groceries', changedAt: Date.now() },
    completed: { value: false, changedAt: Date.now() },
    priority: 1,
};

// Access mutable field values
console.log(todo.title.value); // "Buy groceries"
console.log(todo.title.changedAt); // timestamp

// Access immutable field values
console.log(todo.priority); // 1
```

### Database Storage

```typescript
// Denormalized representation for database
const todoDenorm: TodoDenorm = {
    id: '123',
    createdAt: Date.now(),
    title: 'Buy groceries',
    titleChangedAt: Date.now(),
    completed: false,
    completedChangedAt: Date.now(),
    priority: 1,
};

// Each mutable field becomes two columns
// Immutable fields are single columns
```

## Advanced Patterns

### All-Mutable Collection

```typescript
const schema = defineSchema({
    settings: {
        theme: mutableField<string>(),
        fontSize: mutableField<number>(),
        darkMode: mutableField<boolean>(),
    },
});

type UpdateSettings = InferUpdate<typeof schema, 'settings'>;
// { theme?: string; fontSize?: number; darkMode?: boolean }
// All fields can be updated
```

### All-Immutable Collection

```typescript
const schema = defineSchema({
    logs: {
        message: immutableField<string>(),
        timestamp: immutableField<number>(),
        level: immutableField<'info' | 'warn' | 'error'>(),
    },
});

type UpdateLog = InferUpdate<typeof schema, 'logs'>;
// {} - Empty object, nothing can be updated
```

### Multiple Collections

```typescript
const schema = defineSchema({
    todos: {
        title: mutableField<string>(),
        done: mutableField<boolean>(),
    },
    users: {
        name: mutableField<string>(),
        email: mutableField<string>(),
    },
    posts: {
        content: mutableField<string>(),
        authorId: immutableField<string>(),
    },
});

// Each collection has independent types
type CreateTodo = InferCreate<typeof schema, 'todos'>;
type CreateUser = InferCreate<typeof schema, 'users'>;
type CreatePost = InferCreate<typeof schema, 'posts'>;
```

### Runtime Schema Access

```typescript
const schema = defineSchema({
    todos: {
        title: mutableField<string>(),
    },
});

// Access collection schema at runtime
const todoSchema = schema.collection('todos');
console.log(todoSchema.title.fieldType); // "mutable"

// Access full schema
console.log(schema._schema.todos.title.fieldType); // "mutable"
```

## Design Rationale

### Why Separate from Collection?

The schema DSL is intentionally separate from Collection/ClientCollection:

- **Composable**: Can be used independently
- **Flexible**: Schema definition without implementation coupling
- **Reusable**: Same schema can drive different implementations
- **Testable**: Type inference can be tested independently

### Why Flat Objects Only?

Flat objects simplify:

- **Database mapping**: Direct 1:1 with database columns
- **Type inference**: Easier to reason about nested transformations
- **Performance**: No nested object traversal
- **Clarity**: Clear structure without deep nesting

### Why Auto-include createdAt?

All collections need creation tracking:

- **Auditing**: Know when records were created
- **Sorting**: Default chronological ordering
- **Consistency**: Uniform across all collections
- **Immutable**: Creation time never changes

### Why Denormalized Representation?

Denormalized form matches database schema:

- **SQL compatibility**: Each field is a column
- **Query optimization**: Can index `changedAt` fields
- **Storage efficiency**: No JSON serialization overhead
- **Type safety**: Flat structure is easier to type

## Limitations

Current limitations of the schema DSL:

1. **No Nested Objects**: Only flat structures supported
2. **No Runtime Validation**: Type checking only at compile time
3. **No Default Values**: Fields don't have default values
4. **No Computed Fields**: No derived/calculated fields
5. **No Relationships**: No foreign key constraints

## Future Enhancements

Potential improvements:

- **Runtime Validation**: Zod-like runtime type checking
- **Default Values**: Field-level defaults
- **Constraints**: Min/max, regex patterns, etc.
- **Migrations**: Schema versioning and migrations
- **Relationships**: Foreign key support
- **Indexes**: Define database indexes in schema

## Summary

The Schema DSL provides:

- ✅ **Declarative** schema definition
- ✅ **Type-safe** operations with full inference
- ✅ **Four representations** from one definition
- ✅ **Runtime access** to schema structure
- ✅ **Mutable/immutable** field semantics
- ✅ **Flat structure** for simplicity

Use it to define your collection types once and get all the TypeScript types you need automatically.
