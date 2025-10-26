/**
 * Tests for Schema DSL
 *
 * These tests verify both runtime behavior and TypeScript type inference
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    mutableField,
    immutableField,
    reference,
    type InferCreate,
    type InferUpdate,
    type InferItem,
    type InferDenormalized,
    type InferCollections,
} from '../index';

describe('Schema DSL', () => {
    describe('Field Descriptors', () => {
        it('should create mutable field descriptor', () => {
            const field = mutableField<string>();

            expect(field.fieldType).toBe('mutable');
        });

        it('should create immutable field descriptor', () => {
            const field = immutableField<number>();

            expect(field.fieldType).toBe('immutable');
        });

        it('should only accept valid field descriptors', () => {
            // Valid descriptors work fine
            const validSchema = defineSchema({
                valid: type({
                    fields: {
                        field1: mutableField<string>(),
                        field2: immutableField<number>(),
                    },
                }),
            });

            expect(validSchema).toBeDefined();

            // Invalid descriptor object should not be assignable
            const invalidSchema = defineSchema({
                invalid: type({
                    fields: {
                        // @ts-expect-error - fieldType must be 'mutable' or 'immutable'
                        badField: { fieldType: 'other' },
                    },
                }),
            });

            expect(invalidSchema).toBeDefined();
        });

        it('should create reference field descriptor', () => {
            const field = reference('users');

            expect(field.fieldType).toBe('reference');
            expect(field.referenceCollection).toBe('users');
            expect(field.nullable).toBe(false);
        });

        it('should create nullable reference field descriptor', () => {
            const field = reference('users', { nullable: true });

            expect(field.fieldType).toBe('reference');
            expect(field.referenceCollection).toBe('users');
            expect(field.nullable).toBe(true);
        });
    });

    describe('Schema Definition', () => {
        it('should define a schema with multiple collections', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        completed: mutableField<boolean>(),
                        priority: immutableField<number>(),
                    },
                }),
                users: type({
                    fields: {
                        name: mutableField<string>(),
                        email: mutableField<string>(),
                    },
                }),
            });

            expect(schema._schema).toBeDefined();
            expect(schema._schema.todos).toBeDefined();
            expect(schema._schema.users).toBeDefined();
        });

        it('should access collection schema', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            });

            const todoSchema = schema.collection('todos');

            expect(todoSchema.title).toBeDefined();
            expect(todoSchema.title.fieldType).toBe('mutable');
        });

        it('should prohibit reserved field names', () => {
            const schema1 = defineSchema({
                todos: type({
                    fields: {
                        // @ts-expect-error - id is a reserved field name
                        id: mutableField<string>(),
                        title: mutableField<string>(),
                    },
                }),
            });

            const schema2 = defineSchema({
                todos: type({
                    fields: {
                        // @ts-expect-error - createdAt is a reserved field name
                        createdAt: mutableField<number>(),
                        title: mutableField<string>(),
                    },
                }),
            });

            const schema3 = defineSchema({
                todos: type({
                    fields: {
                        // @ts-expect-error - updatedAt is a reserved field name
                        updatedAt: mutableField<number>(),
                        title: mutableField<string>(),
                    },
                }),
            });

            expect(schema1).toBeDefined();
            expect(schema2).toBeDefined();
            expect(schema3).toBeDefined();
        });
    });

    describe('Type Inference - Create', () => {
        it('should infer create type with id and all fields as plain values', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        completed: mutableField<boolean>(),
                        priority: immutableField<number>(),
                    },
                }),
            });

            type CreateTodo = InferCreate<typeof schema, 'todos'>;

            // Type assertions
            expectTypeOf<CreateTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                completed: boolean;
                priority: number;
            }>();

            // Runtime usage example (compile-time check)
            const validCreate: CreateTodo = {
                id: '123',
                title: 'Test',
                completed: false,
                priority: 1,
            };

            expect(validCreate).toBeDefined();
        });

        it('should require id and not include createdAt in create type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
            });

            type CreateUser = InferCreate<typeof schema, 'users'>;

            // id is required
            const valid: CreateUser = { id: '123', name: 'Alice' };

            // @ts-expect-error - createdAt should not be present
            const invalid: CreateUser = { id: '123', name: 'Alice', createdAt: 123 };

            expect(valid).toBeDefined();
            expect(invalid).toBeDefined();
        });
    });

    describe('Type Inference - Update', () => {
        it('should infer update type with id and only mutable fields as optional', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        completed: mutableField<boolean>(),
                        priority: immutableField<number>(),
                    },
                }),
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // Type assertions
            expectTypeOf<UpdateTodo>().toEqualTypeOf<{
                id: string;
                title?: string;
                completed?: boolean;
            }>();

            // Runtime usage examples - id is required
            const validUpdate1: UpdateTodo = { id: '1', title: 'Updated' };
            const validUpdate2: UpdateTodo = { id: '2', completed: true };
            const validUpdate3: UpdateTodo = { id: '3', title: 'Done', completed: true };
            const validUpdate4: UpdateTodo = { id: '4' };

            expect(validUpdate1).toBeDefined();
            expect(validUpdate2).toBeDefined();
            expect(validUpdate3).toBeDefined();
            expect(validUpdate4).toBeDefined();
        });

        it('should not include immutable fields in update type', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        priority: immutableField<number>(),
                    },
                }),
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // @ts-expect-error - priority is immutable and should not be updatable
            const invalid: UpdateTodo = { id: '1', priority: 5 };

            expect(invalid).toBeDefined();
        });
    });

    describe('Type Inference - Item', () => {
        it('should infer item type with wrapped mutable fields', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        completed: mutableField<boolean>(),
                        priority: immutableField<number>(),
                    },
                }),
            });

            type Todo = InferItem<typeof schema, 'todos'>;

            // Type assertions
            expectTypeOf<Todo>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                title: { value: string; changedAt: number };
                completed: { value: boolean; changedAt: number };
                priority: number;
            }>();

            // Runtime usage example
            const validItem: Todo = {
                id: '123',
                createdAt: Date.now(),
                title: { value: 'Test', changedAt: Date.now() },
                completed: { value: false, changedAt: Date.now() },
                priority: 1,
            };

            expect(validItem).toBeDefined();
        });

        it('should automatically include id and createdAt', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
            });

            type User = InferItem<typeof schema, 'users'>;

            expectTypeOf<User>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                name: { value: string; changedAt: number };
            }>();
        });
    });

    describe('Type Inference - Denormalized', () => {
        it('should infer denormalized type with flat mutable fields', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        completed: mutableField<boolean>(),
                        priority: immutableField<number>(),
                    },
                }),
            });

            type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;

            // Type assertions - mutable fields become two properties
            expectTypeOf<TodoDenorm>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                title: string;
                titleChangedAt: number;
                completed: boolean;
                completedChangedAt: number;
                priority: number;
            }>();

            // Runtime usage example
            const validDenorm: TodoDenorm = {
                id: '123',
                createdAt: Date.now(),
                title: 'Test',
                titleChangedAt: Date.now(),
                completed: false,
                completedChangedAt: Date.now(),
                priority: 1,
            };

            expect(validDenorm).toBeDefined();
        });

        it('should not add changedAt for immutable fields', () => {
            const schema = defineSchema({
                items: type({
                    fields: {
                        name: mutableField<string>(),
                        count: immutableField<number>(),
                    },
                }),
            });

            type ItemDenorm = InferDenormalized<typeof schema, 'items'>;

            // Immutable field should only have one property
            expectTypeOf<ItemDenorm>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                name: string;
                nameChangedAt: number;
                count: number;
            }>();

            const invalid: ItemDenorm = {
                id: '1',
                createdAt: 1,
                name: 'Test',
                nameChangedAt: 1,
                count: 5,
                // @ts-expect-error - countChangedAt should not exist
                countChangedAt: 1,
            };

            expect(invalid).toBeDefined();
        });
    });

    describe('Type Inference - References', () => {
        it('should reject references to non-existent collections', () => {
            const badSchema = defineSchema({
                // @ts-expect-error - references 'users' which doesn't exist
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'),
                    },
                }),
            });

            expect(badSchema).toBeDefined();
        });

        it('should accept valid references', () => {
            const goodSchema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'), // Valid - 'users' exists
                    },
                }),
            });

            expect(goodSchema).toBeDefined();
        });

        it('should infer non-nullable reference in create type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'),
                    },
                }),
            });

            type CreateTodo = InferCreate<typeof schema, 'todos'>;

            expectTypeOf<CreateTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                assignedTo: string;
            }>();

            const validCreate: CreateTodo = {
                id: '1',
                title: 'Task',
                assignedTo: 'user-1',
            };

            expect(validCreate).toBeDefined();
        });

        it('should infer nullable reference in create type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type CreateTodo = InferCreate<typeof schema, 'todos'>;

            expectTypeOf<CreateTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                reviewer: string | null;
            }>();

            const validCreate1: CreateTodo = {
                id: '1',
                title: 'Task',
                reviewer: 'user-1',
            };

            const validCreate2: CreateTodo = {
                id: '2',
                title: 'Task',
                reviewer: null,
            };

            expect(validCreate1).toBeDefined();
            expect(validCreate2).toBeDefined();
        });

        it('should not include references in update type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'),
                    },
                }),
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // References are immutable and should not be in update type
            expectTypeOf<UpdateTodo>().toEqualTypeOf<{
                id: string;
                title?: string;
            }>();

            const validUpdate: UpdateTodo = {
                id: '1',
                title: 'Updated',
            };

            expect(validUpdate).toBeDefined();
        });

        it('should infer references in item type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type Todo = InferItem<typeof schema, 'todos'>;

            expectTypeOf<Todo>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                title: { value: string; changedAt: number };
                assignedTo: string;
                reviewer: string | null;
            }>();

            const validItem: Todo = {
                id: '1',
                createdAt: Date.now(),
                title: { value: 'Task', changedAt: Date.now() },
                assignedTo: 'user-1',
                reviewer: null,
            };

            expect(validItem).toBeDefined();
        });

        it('should infer references in denormalized type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        assignedTo: reference('users'),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;

            expectTypeOf<TodoDenorm>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                title: string;
                titleChangedAt: number;
                assignedTo: string;
                reviewer: string | null;
            }>();

            const validDenorm: TodoDenorm = {
                id: '1',
                createdAt: Date.now(),
                title: 'Task',
                titleChangedAt: Date.now(),
                assignedTo: 'user-1',
                reviewer: 'user-2',
            };

            expect(validDenorm).toBeDefined();
        });
    });

    describe('Complex Schemas', () => {
        it('should handle all-mutable collection', () => {
            const schema = defineSchema({
                settings: type({
                    fields: {
                        theme: mutableField<string>(),
                        fontSize: mutableField<number>(),
                        darkMode: mutableField<boolean>(),
                    },
                }),
            });

            type UpdateSettings = InferUpdate<typeof schema, 'settings'>;

            expectTypeOf<UpdateSettings>().toEqualTypeOf<{
                id: string;
                theme?: string;
                fontSize?: number;
                darkMode?: boolean;
            }>();
        });

        it('should handle all-immutable collection', () => {
            const schema = defineSchema({
                metadata: type({
                    fields: {
                        createdBy: immutableField<string>(),
                        version: immutableField<number>(),
                    },
                }),
            });

            type UpdateMetadata = InferUpdate<typeof schema, 'metadata'>;

            // Should only have id field since no mutable fields
            expectTypeOf<UpdateMetadata>().toEqualTypeOf<{ id: string }>();
        });

        it('should work with multiple collection types', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                        done: mutableField<boolean>(),
                    },
                }),
                users: type({
                    fields: {
                        name: mutableField<string>(),
                        role: immutableField<string>(),
                    },
                }),
                logs: type({
                    fields: {
                        message: immutableField<string>(),
                        timestamp: immutableField<number>(),
                    },
                }),
            });

            type CreateTodo = InferCreate<typeof schema, 'todos'>;
            type CreateUser = InferCreate<typeof schema, 'users'>;
            type CreateLog = InferCreate<typeof schema, 'logs'>;

            expectTypeOf<CreateTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                done: boolean;
            }>();

            expectTypeOf<CreateUser>().toEqualTypeOf<{
                id: string;
                name: string;
                role: string;
            }>();

            expectTypeOf<CreateLog>().toEqualTypeOf<{
                id: string;
                message: string;
                timestamp: number;
            }>();
        });
    });

    describe('Type Inference - InferCollections', () => {
        it('should infer collection names as union type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
                settings: type({
                    fields: {
                        theme: mutableField<string>(),
                    },
                }),
            });

            type Collections = InferCollections<typeof schema>;

            // Should be union of collection names
            expectTypeOf<Collections>().toEqualTypeOf<'users' | 'todos' | 'settings'>();

            // Test that it works in runtime contexts
            const validCollection1: Collections = 'users';
            const validCollection2: Collections = 'todos';
            const validCollection3: Collections = 'settings';

            // @ts-expect-error - invalid collection name
            const invalidCollection: Collections = 'invalid';

            expect(validCollection1).toBe('users');
            expect(validCollection2).toBe('todos');
            expect(validCollection3).toBe('settings');
            expect(invalidCollection).toBe('invalid');
        });

        it('should work with single collection schema', () => {
            const schema = defineSchema({
                items: type({
                    fields: {
                        value: mutableField<number>(),
                    },
                }),
            });

            type Collections = InferCollections<typeof schema>;

            expectTypeOf<Collections>().toEqualTypeOf<'items'>();

            const collection: Collections = 'items';
            expect(collection).toBe('items');
        });

        it('should work with complex multi-collection schemas', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
                posts: type({
                    fields: {
                        title: mutableField<string>(),
                        authorId: reference('users'),
                    },
                }),
                comments: type({
                    fields: {
                        text: mutableField<string>(),
                        postId: reference('posts'),
                        authorId: reference('users'),
                    },
                }),
            });

            type Collections = InferCollections<typeof schema>;

            expectTypeOf<Collections>().toEqualTypeOf<'users' | 'posts' | 'comments'>();
        });

        it('should be useful for generic collection operations', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
                users: type({
                    fields: {
                        name: mutableField<string>(),
                    },
                }),
            });

            type Collections = InferCollections<typeof schema>;

            // Type-safe collection selector with specific return types
            const todoFields = schema.collection('todos');
            const userFields = schema.collection('users');

            // Verify the fields are correctly typed
            expect(todoFields.title.fieldType).toBe('mutable');
            expect(userFields.name.fieldType).toBe('mutable');

            // Verify Collections type is correct
            expectTypeOf<Collections>().toEqualTypeOf<'todos' | 'users'>();

            // Test usage in a generic function
            function hasCollection<T extends Collections>(
                _schema: typeof schema,
                name: T
            ): boolean {
                return name in schema._schema;
            }

            expect(hasCollection(schema, 'todos')).toBe(true);
            expect(hasCollection(schema, 'users')).toBe(true);
        });
    });
});
