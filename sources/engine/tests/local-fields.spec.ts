/**
 * Tests for Local Fields
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
    defineSchema,
    type,
    object,
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

    describe('Rebase Options', () => {
        it('should update local fields when allowLocalFields is true', () => {
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

            const engine = syncEngine(schema);

            // Create item with default local field
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Test',
                }],
            });

            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);

            // Update local field with allowLocalFields: true
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    isExpanded: true,
                }],
            }, { allowLocalFields: true });

            // Local field should be updated
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(true);
        });

        it('should ignore server fields when allowServerFields is false', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema);

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Original',
                    completed: false,
                }],
            });

            // Try to update with allowServerFields: false
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated',
                    completed: true,
                }],
            }, { allowServerFields: false });

            // Server fields should NOT be updated
            expect(engine.serverState.todos['todo-1'].title).toBe('Original');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);
        });

        it('should update only local fields when both options are set appropriately', () => {
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

            const engine = syncEngine(schema);

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Original',
                }],
            });

            // Update both, but only allow local fields
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated',
                    isExpanded: true,
                }],
            }, { allowServerFields: false, allowLocalFields: true });

            // Only local field should be updated
            expect(engine.serverState.todos['todo-1'].title).toBe('Original');
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(true);
        });

        it('should update both server and local fields when both are allowed', () => {
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

            const engine = syncEngine(schema);

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Original',
                }],
            });

            // Update both with allowLocalFields: true
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated',
                    isExpanded: true,
                }],
            }, { allowLocalFields: true });

            // Both should be updated
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated');
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(true);
        });

        it('should patch both states directly when direct is true', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                    }),
                },
                mutations: {
                    toggleCompleted: z.object({ id: z.string() }),
                },
            });

            const engine = syncEngine(schema);

            engine.addMutator('toggleCompleted', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = !draft.todos[input.id].completed;
                }
            });

            // Create item
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Test',
                    completed: false,
                }],
            });

            // Apply mutation
            engine.mutate('toggleCompleted', { id: 'todo-1' });
            expect(engine.state.todos['todo-1'].completed).toBe(true);

            // Update server with direct: true (should not reapply mutation)
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated',
                }],
            }, { direct: true });

            // serverState should be updated
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated');

            // Direct mode: both states patched, mutation NOT reapplied
            // State is patched with new title, but completed stays true (not in update)
            expect(engine.state.todos['todo-1'].title).toBe('Updated');
            expect(engine.state.todos['todo-1'].completed).toBe(true);
        });

        it('should work with singleton objects and allowLocalFields', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                            isExpanded: localField(false),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema);

            // Create singleton
            engine.rebase({
                settings: {
                    theme: 'light',
                },
            });

            expect(engine.serverState.settings.isExpanded).toBe(false);

            // Update local field
            engine.rebase({
                settings: {
                    isExpanded: true,
                },
            }, { allowLocalFields: true });

            expect(engine.serverState.settings.theme).toBe('light');
            expect(engine.serverState.settings.isExpanded).toBe(true);
        });

        it('should preserve default behavior when no options provided', () => {
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

            const engine = syncEngine(schema);

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Test',
                }],
            });

            // Try to update local field without options (should be ignored)
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated',
                    isExpanded: true,
                }],
            });

            // Server field updated, local field ignored (default behavior)
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated');
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);
        });
    });
});
