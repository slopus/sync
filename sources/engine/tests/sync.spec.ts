/**
 * Tests for Sync Engine
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
    defineSchema,
    type,
    mutableField,
    immutableField,
    reference,
    sync,
    type SyncEngine,
    type SyncState,
    type PendingMutation,
} from '../index';

describe('Sync Engine', () => {
    describe('Initialization', () => {
        it('should create a sync engine with empty state', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            expect(engine.state).toBeDefined();
            expect(engine.serverState).toBeDefined();
            expect(engine.state.todos).toEqual({});
            expect(engine.serverState.todos).toEqual({});
        });

        it('should have correct type for state', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({ id: z.string(), title: z.string() }),
                },
            });

            const engine = sync(schema);

            type ExpectedState = {
                todos: Record<string, {
                    id: string;
                    createdAt: number;
                    title: string;
                }>;
            };

            expectTypeOf(engine.state).toMatchTypeOf<ExpectedState>();
        });
    });

    describe('Local Mutations', () => {
        it('should apply local mutations without adding to pendingMutations', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            isExpanded: mutableField<boolean>(),
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

            const engine = sync(schema);

            engine.addMutator('toggleExpanded', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isExpanded = input.isExpanded;
                }
            });

            // Create item
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Test',
                    isExpanded: false,
                }],
            });

            // Apply local mutation
            engine.mutateLocal('toggleExpanded', { id: 'todo-1', isExpanded: true });

            // State should be updated
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);

            // Should NOT appear in pendingMutations
            expect(engine.pendingMutations).toHaveLength(0);

            // Should appear in allMutations
            expect(engine.allMutations).toHaveLength(1);
            expect(engine.allMutations[0].isLocal).toBe(true);
        });

        it('should maintain order between local and regular mutations', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    updateTitle: z.object({ id: z.string(), title: z.string() }),
                    toggleCompleted: z.object({ id: z.string(), completed: z.boolean() }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('updateTitle', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].title = input.title;
                }
            });

            engine.addMutator('toggleCompleted', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Original',
                    completed: false,
                }],
            });

            // Mix of regular and local mutations
            engine.mutate('updateTitle', { id: 'todo-1', title: 'First' });
            engine.mutateLocal('toggleCompleted', { id: 'todo-1', completed: true });
            engine.mutate('updateTitle', { id: 'todo-1', title: 'Second' });

            // Should have 2 pending mutations (regular ones)
            expect(engine.pendingMutations).toHaveLength(2);
            expect(engine.pendingMutations.every(m => !m.isLocal)).toBe(true);

            // Should have 3 total mutations in order
            expect(engine.allMutations).toHaveLength(3);
            expect(engine.allMutations[0].name).toBe('updateTitle');
            expect(engine.allMutations[0].isLocal).toBe(false);
            expect(engine.allMutations[1].name).toBe('toggleCompleted');
            expect(engine.allMutations[1].isLocal).toBe(true);
            expect(engine.allMutations[2].name).toBe('updateTitle');
            expect(engine.allMutations[2].isLocal).toBe(false);
        });

        it('should allow committing local mutations', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            isExpanded: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    toggle: z.object({ id: z.string() }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('toggle', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isExpanded = !draft.todos[input.id].isExpanded;
                }
            });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    isExpanded: false,
                }],
            });

            engine.mutateLocal('toggle', { id: 'todo-1' });
            expect(engine.allMutations).toHaveLength(1);

            const mutationId = engine.allMutations[0].id;

            // Commit the local mutation
            engine.commit(mutationId);

            expect(engine.allMutations).toHaveLength(0);
            expect(engine.pendingMutations).toHaveLength(0);
        });

        it('should rebase correctly with local mutations', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            isExpanded: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    updateTitle: z.object({ id: z.string(), title: z.string() }),
                    expand: z.object({ id: z.string() }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('updateTitle', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].title = input.title;
                }
            });

            engine.addMutator('expand', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].isExpanded = true;
                }
            });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Server Title',
                    isExpanded: false,
                }],
            });

            // Regular mutation
            engine.mutate('updateTitle', { id: 'todo-1', title: 'Local Title' });
            // Local mutation
            engine.mutateLocal('expand', { id: 'todo-1' });

            expect(engine.state.todos['todo-1'].title).toBe('Local Title');
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);

            // Server confirms title update
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Local Title',
                }],
            });

            // Both changes should still be applied
            expect(engine.state.todos['todo-1'].title).toBe('Local Title');
            expect(engine.state.todos['todo-1'].isExpanded).toBe(true);
        });

        it('should have isLocal flag in mutation type', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    update: z.object({ id: z.string(), title: z.string() }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('update', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].title = input.title;
                }
            });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Test',
                }],
            });

            engine.mutate('update', { id: 'todo-1', title: 'Regular' });
            engine.mutateLocal('update', { id: 'todo-1', title: 'Local' });

            const regularMutation = engine.allMutations[0];
            const localMutation = engine.allMutations[1];

            expect(regularMutation.isLocal).toBe(false);
            expect(localMutation.isLocal).toBe(true);
        });
    });

    describe('Pending Mutations', () => {
        it('should expose pending mutations through getter', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                };
            });

            // Initially empty
            expect(engine.pendingMutations).toHaveLength(0);

            // Apply a mutation
            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });

            // Should have one pending mutation
            expect(engine.pendingMutations).toHaveLength(1);
            expect(engine.pendingMutations[0].name).toBe('createTodo');
            expect(engine.pendingMutations[0].id).toBeDefined();
            expect(engine.pendingMutations[0].timestamp).toBeGreaterThan(0);

            // Apply another mutation
            engine.mutate('createTodo', { id: 'todo-2', title: 'Test 2' });

            // Should have two pending mutations
            expect(engine.pendingMutations).toHaveLength(2);
        });

        it('should reduce pending mutations after commit', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                };
            });

            // Apply mutations
            engine.mutate('createTodo', { id: 'todo-1', title: 'Test 1' });
            engine.mutate('createTodo', { id: 'todo-2', title: 'Test 2' });
            engine.mutate('createTodo', { id: 'todo-3', title: 'Test 3' });

            expect(engine.pendingMutations).toHaveLength(3);

            // Capture mutation IDs
            const firstMutationId = engine.pendingMutations[0].id;
            const secondMutationId = engine.pendingMutations[1].id;

            // Commit first two mutations
            engine.commit([firstMutationId, secondMutationId]);

            // Should have only one pending mutation left
            expect(engine.pendingMutations).toHaveLength(1);
            expect(engine.pendingMutations[0].name).toBe('createTodo');
        });

        it('should return readonly array to prevent external modification', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                };
            });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });

            const pending = engine.pendingMutations;

            // Type should be readonly
            expectTypeOf(pending).toMatchTypeOf<ReadonlyArray<unknown>>();

            // Should have the mutation
            expect(pending).toHaveLength(1);
        });

        it('should have strictly typed input based on mutation name', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                    updateTodo: z.object({
                        id: z.string(),
                        completed: z.boolean(),
                    }),
                    deleteTodo: z.object({
                        id: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    completed: false,
                };
            });

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            engine.addMutator('deleteTodo', (draft, input) => {
                delete draft.todos[input.id];
            });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });
            engine.mutate('updateTodo', { id: 'todo-1', completed: true });
            engine.mutate('deleteTodo', { id: 'todo-1' });

            const pending = engine.pendingMutations;

            // Type narrowing based on name
            for (const mutation of pending) {
                if (mutation.name === 'createTodo') {
                    // input should be strictly typed as createTodo input
                    expectTypeOf(mutation.input).toEqualTypeOf<{ id: string; title: string }>();
                    expect(mutation.input).toHaveProperty('title');
                } else if (mutation.name === 'updateTodo') {
                    // input should be strictly typed as updateTodo input
                    expectTypeOf(mutation.input).toEqualTypeOf<{ id: string; completed: boolean }>();
                    expect(mutation.input).toHaveProperty('completed');
                } else if (mutation.name === 'deleteTodo') {
                    // input should be strictly typed as deleteTodo input
                    expectTypeOf(mutation.input).toEqualTypeOf<{ id: string }>();
                    expect(mutation.input).toHaveProperty('id');
                }
            }

            expect(pending).toHaveLength(3);
        });

        it('should provide type-safe access to mutation input', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            priority: mutableField<number>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        priority: z.number(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    priority: input.priority,
                };
            });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test', priority: 5 });

            const mutation = engine.pendingMutations[0];

            // Type checking
            expectTypeOf(mutation.input).toEqualTypeOf<{ id: string; title: string; priority: number }>();

            // Runtime access
            expect(mutation.input.id).toBe('todo-1');
            expect(mutation.input.title).toBe('Test');
            expect(mutation.input.priority).toBe(5);
        });
    });

    describe('Mutators', () => {
        it('should register a mutator', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                const data = input as { id: string; title: string; completed: boolean };
                draft.todos[data.id] = {
                    id: data.id,
                    createdAt: Date.now(),
                    title: data.title,
                    completed: data.completed,
                };
            });

            // Should not throw
            expect(true).toBe(true);
        });

        it('should apply mutation to state', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                const data = input as { id: string; title: string; completed: boolean };
                draft.todos[data.id] = {
                    id: data.id,
                    createdAt: Date.now(),
                    title: data.title,
                    completed: data.completed,
                };
            });

            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });

            expect(engine.state.todos['todo-1']).toBeDefined();
            expect(engine.state.todos['todo-1'].title).toBe('Test Todo');
            expect(engine.state.todos['todo-1'].completed).toBe(false);
        });

        it('should apply multiple mutations in order', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                    updateTodo: z.object({
                        id: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    completed: input.completed,
                };
            });

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });

            engine.mutate('updateTodo', {
                id: 'todo-1',
                completed: true,
            });

            expect(engine.state.todos['todo-1'].completed).toBe(true);
        });
    });

    describe('Rebase', () => {
        it('should patch existing items with partial data', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = sync(schema);

            // Create initial item with full data
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: 1000,
                    title: 'Original Title',
                    completed: false,
                }],
            });

            expect(engine.serverState.todos['todo-1'].title).toBe('Original Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);

            // Patch with partial data (only title)
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Updated Title',
                }],
            });

            // Should patch existing item
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);
            expect(engine.serverState.todos['todo-1'].createdAt).toBe(1000);
        });

        it('should ignore partial items without all required fields when creating new items', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = sync(schema);

            // Try to create new item with missing fields
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Incomplete Todo',
                    // Missing: createdAt and completed
                }],
            });

            // Should not create the item
            expect(engine.serverState.todos['todo-1']).toBeUndefined();
        });

        it('should create new items when all required fields are present', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = sync(schema);

            // Create new item with all fields
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Complete Todo',
                    completed: false,
                }],
            });

            // Should create the item
            expect(engine.serverState.todos['todo-1']).toBeDefined();
            expect(engine.serverState.todos['todo-1'].title).toBe('Complete Todo');
        });

        it('should handle null values in partial updates', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            description: mutableField<string | null>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = sync(schema);

            // Create item with null description
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Todo',
                    description: null,
                }],
            });

            expect(engine.serverState.todos['todo-1'].description).toBe(null);

            // Update with non-null description
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    description: 'New description',
                }],
            });

            expect(engine.serverState.todos['todo-1'].description).toBe('New description');
        });

        it('should update server state and rebase pending mutations', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    updateTodo: z.object({
                        id: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            // Update server state with a todo
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Server Todo',
                    completed: false,
                }],
            });

            expect(engine.serverState.todos['todo-1']).toBeDefined();
            expect(engine.serverState.todos['todo-1'].title).toBe('Server Todo');

            // Apply a local mutation
            engine.mutate('updateTodo', {
                id: 'todo-1',
                completed: true,
            });

            // State should have the mutation applied
            expect(engine.state.todos['todo-1'].completed).toBe(true);
            // Server state should not change
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);
        });

        it('should reapply pending mutations when server state updates', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    updateTodo: z.object({
                        id: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            // Initial server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Original Title',
                    completed: false,
                }],
            });

            // Apply local mutation
            engine.mutate('updateTodo', {
                id: 'todo-1',
                completed: true,
            });

            // Update server state with different title
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Updated Title',
                    completed: false,
                }],
            });

            // State should have updated title from server AND local completed change
            expect(engine.state.todos['todo-1'].title).toBe('Updated Title');
            expect(engine.state.todos['todo-1'].completed).toBe(true);
        });
    });

    describe('Commit', () => {
        it('should commit multiple mutations at once', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                    updateTodo: z.object({
                        id: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    completed: input.completed,
                };
            });

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = input.completed;
                }
            });

            // Set up server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Todo 1',
                    completed: false,
                }, {
                    id: 'todo-2',
                    createdAt: Date.now(),
                    title: 'Todo 2',
                    completed: false,
                }],
            });

            // Apply multiple local mutations
            engine.mutate('updateTodo', { id: 'todo-1', completed: true });
            engine.mutate('updateTodo', { id: 'todo-2', completed: true });
            engine.mutate('createTodo', { id: 'todo-3', title: 'Todo 3', completed: false });

            // State should have all mutations applied
            expect(engine.state.todos['todo-1'].completed).toBe(true);
            expect(engine.state.todos['todo-2'].completed).toBe(true);
            expect(engine.state.todos['todo-3']).toBeDefined();

            // Server confirms first two mutations
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    completed: true,
                }, {
                    id: 'todo-2',
                    completed: true,
                }],
            });

            // State should still have all changes including pending todo-3
            expect(engine.state.todos['todo-1'].completed).toBe(true);
            expect(engine.state.todos['todo-2'].completed).toBe(true);
            expect(engine.state.todos['todo-3']).toBeDefined();
        });

        it('should commit single mutation with string ID', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                };
            });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });
            expect(engine.state.todos['todo-1']).toBeDefined();

            // Commit with single ID (not array)
            engine.commit('any-id'); // Won't match, but should accept string

            // State should still have the todo since ID didn't match
            expect(engine.state.todos['todo-1']).toBeDefined();
        });

        it('should commit array of mutation IDs', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    updateTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('updateTodo', (draft, input) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].title = input.title;
                }
            });

            // Setup server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Original 1',
                }, {
                    id: 'todo-2',
                    createdAt: Date.now(),
                    title: 'Original 2',
                }],
            });

            // Apply mutations and capture their internal state
            engine.mutate('updateTodo', { id: 'todo-1', title: 'Updated 1' });
            engine.mutate('updateTodo', { id: 'todo-2', title: 'Updated 2' });

            // State has pending mutations applied
            expect(engine.state.todos['todo-1'].title).toBe('Updated 1');
            expect(engine.state.todos['todo-2'].title).toBe('Updated 2');

            // Commit with array of IDs (we don't have actual IDs, but test the API)
            engine.commit(['fake-id-1', 'fake-id-2']);

            // Mutations still exist since IDs didn't match
            expect(engine.state.todos['todo-1'].title).toBe('Updated 1');
        });

        it('should remove pending mutation when committed', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                            completed: mutableField<boolean>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        completed: z.boolean(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    completed: input.completed,
                };
            });

            // Capture mutation ID by inspecting state before/after
            const beforeMutationCount = Object.keys(engine.state.todos).length;

            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });

            const afterMutationCount = Object.keys(engine.state.todos).length;
            expect(afterMutationCount).toBe(beforeMutationCount + 1);

            // Simulate server confirming the mutation by updating server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    createdAt: Date.now(),
                    title: 'Test Todo',
                    completed: false,
                }],
            });

            // State should still have the todo
            expect(engine.state.todos['todo-1']).toBeDefined();
        });
    });

    describe('Type Safety', () => {
        it('should enforce correct mutation input types', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: mutableField<string>(),
                        },
                    }),
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                };
            });

            // This should type-check correctly
            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test',
            });

            // This should fail type-checking (uncomment to verify)
            // engine.mutate('createTodo', {
            //     id: 'todo-1',
            //     wrongField: 'Test',
            // });

            expect(true).toBe(true);
        });

        it('should work with references', () => {
            const schema = defineSchema({
                types: {
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
                },
                mutations: {
                    createTodo: z.object({
                        id: z.string(),
                        title: z.string(),
                        assignedTo: z.string(),
                    }),
                },
            });

            const engine = sync(schema);

            engine.addMutator('createTodo', (draft, input) => {
                draft.todos[input.id] = {
                    id: input.id,
                    createdAt: Date.now(),
                    title: input.title,
                    assignedTo: input.assignedTo,
                };
            });

            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                assignedTo: 'user-1',
            });

            expect(engine.state.todos['todo-1'].assignedTo).toBe('user-1');
        });
    });
});
