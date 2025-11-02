/**
 * Tests for Local Fields
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
    defineSchema,
    type,
    field,
    localField,
    syncEngine,
    type InferCreate,
    type InferUpdate,
    type InferItem,
    type InferItemState,
} from '../index';

describe('Local Fields', () => {
    describe('Schema Definition', () => {
        it('should create local field with default value', () => {
            const field = localField(false);

            expect(field.fieldType).toBe('local');
            expect(field.defaultValue).toBe(false);
        });

        it('should define schema with local fields', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                            isSelected: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            const fields = schema.collection('todos');
            expect(fields.isExpanded.fieldType).toBe('local');
            expect(fields.isExpanded.defaultValue).toBe(false);
        });
    });

    describe('Type Inference - Create', () => {
        it('should NOT include local fields in Create type', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            type CreateTodo = InferCreate<typeof schema, 'todos'>;

            // Local fields should not be in Create type
            expectTypeOf<CreateTodo>().toEqualTypeOf<{
                id: string;
                title: string;
                completed: boolean;
                // isExpanded is NOT included
            }>();
        });
    });

    describe('Type Inference - Update', () => {
        it('should include local fields in Update type', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            type UpdateTodo = InferUpdate<typeof schema, 'todos'>;

            // Local fields should be updatable
            expectTypeOf<UpdateTodo>().toEqualTypeOf<{
                id: string;
                title?: string;
                isExpanded?: boolean;
            }>();
        });
    });

    describe('Type Inference - Item', () => {
        it('should wrap local fields with value and version', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            type Todo = InferItem<typeof schema, 'todos'>;

            // Local fields should have same structure as mutable fields
            expectTypeOf<Todo>().toMatchTypeOf<{
                id: string;
                createdAt: number;
                title: { value: string; version: number };
                isExpanded: { value: boolean; version: number };
            }>();
        });
    });

    describe('Type Inference - ItemState', () => {
        it('should represent local fields as plain values', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            type TodoState = InferItemState<typeof schema, 'todos'>;

            expectTypeOf<TodoState>().toEqualTypeOf<{
                id: string;
                createdAt: number;
                title: string;
                isExpanded: boolean;
            }>();
        });
    });

    describe('Sync Engine Behavior', () => {
        it('should initialize local fields with defaults when creating from server', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                            isSelected: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema);

            // Server doesn't include local fields
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Test Todo',
                }],
            });

            // Local fields should be initialized with defaults
            expect(engine.serverState.todos['todo-1']).toBeDefined();
            expect(engine.serverState.todos['todo-1'].title).toBe('Test Todo');
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);
            expect(engine.serverState.todos['todo-1'].isSelected).toBe(false);
        });

        it('should NOT update local fields from server when patching', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {
                    toggleExpanded: z.object({
                        id: z.string(),
                        isExpanded: z.boolean(),
                    }),
                },
            });

            const engine = syncEngine(schema);

            engine.addMutator('toggleExpanded', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isExpanded = input.isExpanded;
                }
            });

            // Create initial item
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Original Title',
                }],
            });

            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);

            // Locally toggle expansion
            engine.mutate('toggleExpanded', { id: 'todo-1', isExpanded: true });
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);

            // Server sends update with isExpanded (should be ignored)
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated Title',
                    isExpanded: false, // This should be ignored
                }],
            });

            // Title should update but isExpanded should remain true (client-side)
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated Title');
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false); // Still default
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true); // Still from local mutation
        });

        it('should allow local mutations on local fields', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                            isSelected: localField(false),
                        },
                    }),
                },
                mutations: {
                    toggleSelection: z.object({
                        id: z.string(),
                        isSelected: z.boolean(),
                    }),
                },
            });

            const engine = syncEngine(schema);

            engine.addMutator('toggleSelection', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isSelected = input.isSelected;
                }
            });

            // Create item from server
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Test',
                }],
            });

            expect(engine.state.todos['todo-1'].isSelected).toBe(false);

            // Toggle selection locally
            engine.mutate('toggleSelection', { id: 'todo-1', isSelected: true });

            expect(engine.state.todos['todo-1'].isSelected).toBe(true);

            // Toggle back
            engine.mutate('toggleSelection', { id: 'todo-1', isSelected: false });

            expect(engine.state.todos['todo-1'].isSelected).toBe(false);
        });

        it('should preserve local fields through rebases', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            priority: field<number>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {
                    expand: z.object({
                        id: z.string(),
                    }),
                    updatePriority: z.object({
                        id: z.string(),
                        priority: z.number(),
                    }),
                },
            });

            const engine = syncEngine(schema);

            engine.addMutator('expand', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isExpanded = true;
                }
            });

            engine.addMutator('updatePriority', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].priority = input.priority;
                }
            });

            // Initial server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Task',
                    priority: 1,
                }],
            });

            // Local mutations
            engine.mutate('expand', { id: 'todo-1' });
            engine.mutate('updatePriority', { id: 'todo-1', priority: 5 });

            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);
            expect(engine.state.todos['todo-1'].priority).toBe(5);

            // Server updates (confirms priority but doesn't know about isExpanded)
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    priority: 5,
                }],
            });

            // isExpanded should remain true (preserved through rebase)
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);
            expect(engine.state.todos['todo-1'].priority).toBe(5);
        });

        it('should work with different default value types', () => {
            const schema = defineSchema({
                types: {
                    items: type({
                        fields: {
                            name: field<string>(),
                            expanded: localField(false),
                            selectedCount: localField(0),
                            tags: localField<string[]>([]),
                            metadata: localField<{ foo: string }>({ foo: 'bar' }),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema);

            engine.rebase({
                items: [{
                    id: 'item-1',
                    createdAt: Date.now(),
                    name: 'Test',
                }],
            });

            const item = engine.serverState.items['item-1'];
            expect(item.expanded).toBe(false);
            expect(item.selectedCount).toBe(0);
            expect(item.tags).toEqual([]);
            expect(item.metadata).toEqual({ foo: 'bar' });
        });
    });
});
