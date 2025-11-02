/**
 * Tests for Schema DSL
 *
 * These tests verify both runtime behavior and TypeScript type inference
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    field,
    localField,
    reference,
    type InferCreate,
    type InferUpdate,
    type InferUpdateFull,
    type InferItem,
    type InferItemState,
    type InferDenormalized,
    type InferCollections,
} from '../index';

describe('Schema DSL', () => {
    describe('Field Descriptors', () => {
        it('should create regular field descriptor', () => {
            const fieldDesc = field<string>();

            expect(fieldDesc.fieldType).toBe('field');
        });

        it('should only accept valid field descriptors', () => {
            // Valid descriptors work fine
            const validSchema = defineSchema({
                valid: type({
                    fields: {
                        field1: field<string>(),
                        field2: field<number>(),
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
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
                users: type({
                    fields: {
                        name: field<string>(),
                        email: field<string>(),
                    },
                }),
            });

            expect(schema._schema).toBeDefined();
            expect(schema._schema.types.todos).toBeDefined();
            expect(schema._schema.types.users).toBeDefined();
        });

        it('should access collection schema', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            });

            const todoSchema = schema.collection('todos');

            expect(todoSchema.title).toBeDefined();
            expect(todoSchema.title.fieldType).toBe('field');
        });

        it('should prohibit reserved field names', () => {
            const schema1 = defineSchema({
                todos: type({
                    fields: {
                        // @ts-expect-error - id is a reserved field name
                        id: field<string>(),
                        title: field<string>(),
                    },
                }),
            });

            expect(schema1).toBeDefined();
        });
    });

    describe('Type Inference - Create', () => {
        it('should infer create type with id and all fields as plain values', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
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

        it('should require id in create type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
            });

            type CreateUser = InferCreate<typeof schema, 'users'>;

            // id is required
            const valid: CreateUser = { id: '123', name: 'Alice' };

            expect(valid).toBeDefined();
        });
    });

    describe('Type Inference - Update', () => {
        it('should infer update type with id and all regular fields as optional', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // Type assertions - all regular fields are optional in updates
            expectTypeOf<UpdateTodo>().toEqualTypeOf<{
                id: string;
                title?: string;
                completed?: boolean;
                priority?: number;
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

        it('should include all regular fields in update type', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        priority: field<number>(),
                    },
                }),
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // All regular fields are updatable
            const valid: UpdateTodo = { id: '1', priority: 5 };

            expect(valid).toBeDefined();
        });
    });

    describe('Type Inference - UpdateFull', () => {
        it('should require all fields in UpdateFull type', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
            });

            type UpdateFullTodo = InferUpdateFull<typeof schema, 'todos'>;

            // Type assertions - all regular fields are required in full updates
            expectTypeOf<UpdateFullTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                completed: boolean;
                priority: number;
            }>();

            // Runtime usage - all fields must be provided
            const validUpdate: UpdateFullTodo = {
                id: '1',
                title: 'Full Update',
                completed: true,
                priority: 5
            };

            expect(validUpdate).toBeDefined();
        });

        it('should exclude references from UpdateFull type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                        assignedTo: reference('users'),
                    },
                }),
            });

            type UpdateFullTodo = InferUpdateFull<typeof schema, 'todos'>;

            // References are immutable and should not be in update type
            expectTypeOf<UpdateFullTodo>().toEqualTypeOf<{
                id: string;
                title: string;
            }>();
        });

        it('should include local fields in UpdateFull type', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        isExpanded: localField(false),
                    },
                }),
            });

            type UpdateFullTodo = InferUpdateFull<typeof schema, 'todos'>;

            // Local fields should be updatable
            expectTypeOf<UpdateFullTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                isExpanded: boolean;
            }>();
        });
    });

    describe('Type Inference - Item', () => {
        it('should infer item type with wrapped regular fields', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
            });

            type Todo = InferItem<typeof schema, 'todos'>;

            // Type assertions - all regular fields are wrapped
            expectTypeOf<Todo>().toMatchTypeOf<{
                id: string;
                title: { value: string; version: number };
                completed: { value: boolean; version: number };
                priority: { value: number; version: number };
            }>();

            // Runtime usage example
            const validItem: Todo = {
                id: '123',
                title: { value: 'Test', version: Date.now() },
                completed: { value: false, version: Date.now() },
                priority: { value: 1, version: Date.now() },
            };

            expect(validItem).toBeDefined();
        });

        it('should automatically include id and createdAt', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
            });

            type User = InferItem<typeof schema, 'users'>;

            expectTypeOf<User>().toMatchTypeOf<{
                id: string;
                name: { value: string; version: number };
            }>();
        });
    });

    describe('Type Inference - ItemState', () => {
        it('should infer item state type with plain values', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
            });

            type TodoState = InferItemState<typeof schema, 'todos'>;

            // Type assertions - all fields are plain values
            expectTypeOf<TodoState>().toMatchTypeOf<{
                id: string;
                title: string;
                completed: boolean;
                priority: number;
            }>();

            // Runtime usage example
            const validItem: TodoState = {
                id: '123',
                title: 'Test',
                completed: false,
                priority: 1,
            };

            expect(validItem).toBeDefined();
        });

        it('should handle references in item state', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                        assignedTo: reference('users'),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type TodoState = InferItemState<typeof schema, 'todos'>;

            expectTypeOf<TodoState>().toMatchTypeOf<{
                id: string;
                title: string;
                assignedTo: string;
                reviewer: string | null;
            }>();
        });

        it('should differ from InferItem by having plain values', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            });

            type TodoItem = InferItem<typeof schema, 'todos'>;
            type TodoState = InferItemState<typeof schema, 'todos'>;

            // InferItem wraps mutable fields
            expectTypeOf<TodoItem['title']>().toEqualTypeOf<{ value: string; version: number }>();

            // InferItemState has plain values
            expectTypeOf<TodoState['title']>().toEqualTypeOf<string>();
        });
    });

    describe('Type Inference - Denormalized', () => {
        it('should infer denormalized type with flat mutable fields', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
            });

            type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;

            // Type assertions - mutable fields become two properties
            expectTypeOf<TodoDenorm>().toMatchTypeOf<{
                id: string;
                title: string;
                titleVersion: number;
                completed: boolean;
                completedVersion: number;
                priority: number;
                priorityVersion: number;
            }>();

            // Runtime usage example
            const validDenorm: TodoDenorm = {
                id: '123',
                title: 'Test',
                titleVersion: Date.now(),
                completed: false,
                completedVersion: Date.now(),
                priority: 1,
                priorityVersion: Date.now(),
            };

            expect(validDenorm).toBeDefined();
        });

        it('should add version for all regular fields', () => {
            const schema = defineSchema({
                items: type({
                    fields: {
                        name: field<string>(),
                        count: field<number>(),
                    },
                }),
            });

            type ItemDenorm = InferDenormalized<typeof schema, 'items'>;

            // All regular fields should have version
            expectTypeOf<ItemDenorm>().toMatchTypeOf<{
                id: string;
                name: string;
                nameVersion: number;
                count: number;
                countVersion: number;
            }>();

            const valid: ItemDenorm = {
                id: '1',
                name: 'Test',
                nameVersion: 1,
                count: 5,
                countVersion: 1,
            };

            expect(valid).toBeDefined();
        });
    });

    describe('Type Inference - References', () => {
        it('should reject references to non-existent collections', () => {
            const badSchema = defineSchema({
                // @ts-expect-error - references 'users' which doesn't exist
                todos: type({
                    fields: {
                        title: field<string>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                        assignedTo: reference('users'),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type Todo = InferItem<typeof schema, 'todos'>;

            expectTypeOf<Todo>().toMatchTypeOf<{
                id: string;
                title: { value: string; version: number };
                assignedTo: string;
                reviewer: string | null;
            }>();

            const validItem: Todo = {
                id: '1',
                title: { value: 'Task', version: Date.now() },
                assignedTo: 'user-1',
                reviewer: null,
            };

            expect(validItem).toBeDefined();
        });

        it('should infer references in denormalized type', () => {
            const schema = defineSchema({
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                        assignedTo: reference('users'),
                        reviewer: reference('users', { nullable: true }),
                    },
                }),
            });

            type TodoDenorm = InferDenormalized<typeof schema, 'todos'>;

            expectTypeOf<TodoDenorm>().toMatchTypeOf<{
                id: string;
                title: string;
                titleVersion: number;
                assignedTo: string;
                reviewer: string | null;
            }>();

            const validDenorm: TodoDenorm = {
                id: '1',
                title: 'Task',
                titleVersion: Date.now(),
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
                        theme: field<string>(),
                        fontSize: field<number>(),
                        darkMode: field<boolean>(),
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

        it('should handle all regular fields in update type', () => {
            const schema = defineSchema({
                metadata: type({
                    fields: {
                        createdBy: field<string>(),
                        version: field<number>(),
                    },
                }),
            });

            type UpdateMetadata = InferUpdate<typeof schema, 'metadata'>;

            // All regular fields are updatable
            expectTypeOf<UpdateMetadata>().toEqualTypeOf<{
                id: string;
                createdBy?: string;
                version?: number;
            }>();
        });

        it('should work with multiple collection types', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        done: field<boolean>(),
                    },
                }),
                users: type({
                    fields: {
                        name: field<string>(),
                        role: field<string>(),
                    },
                }),
                logs: type({
                    fields: {
                        message: field<string>(),
                        timestamp: field<number>(),
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
                        name: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
                settings: type({
                    fields: {
                        theme: field<string>(),
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
                        value: field<number>(),
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
                        name: field<string>(),
                    },
                }),
                posts: type({
                    fields: {
                        title: field<string>(),
                        authorId: reference('users'),
                    },
                }),
                comments: type({
                    fields: {
                        text: field<string>(),
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
                        title: field<string>(),
                    },
                }),
                users: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
            });

            type Collections = InferCollections<typeof schema>;

            // Type-safe collection selector with specific return types
            const todoFields = schema.collection('todos');
            const userFields = schema.collection('users');

            // Verify the fields are correctly typed
            expect(todoFields.title.fieldType).toBe('field');
            expect(userFields.name.fieldType).toBe('field');

            // Verify Collections type is correct
            expectTypeOf<Collections>().toEqualTypeOf<'todos' | 'users'>();

            // Test usage in a generic function
            function hasCollection<T extends Collections>(
                _schema: typeof schema,
                name: T
            ): boolean {
                return name in schema._schema.types;
            }

            expect(hasCollection(schema, 'todos')).toBe(true);
            expect(hasCollection(schema, 'users')).toBe(true);
        });
    });
});
