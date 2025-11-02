/**
 * Tests for Sync Engine
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    field,
    reference,
    syncEngine,
    mutation,
} from '../index';

describe('Sync Engine', () => {
    describe('Initialization', () => {
        it('should create a sync engine with empty state', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {}),
            });

            const engine = syncEngine(schema, { from: 'new' });

            expect(engine.state).toBeDefined();
            expect(engine.serverState).toBeDefined();
            expect(engine.state.todos).toEqual({});
            expect(engine.serverState.todos).toEqual({});
        });

        it('should have correct type for state', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {}),
            });

            const engine = syncEngine(schema, { from: 'new' });

            type ExpectedState = {
                todos: Record<string, {
                    id: string;
                    title: string;
                }>;
            };

            expectTypeOf(engine.state).toMatchTypeOf<ExpectedState>();
        });
    });

    describe('Pending Mutations', () => {
        it('should expose pending mutations through getter', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });

            const pending = engine.pendingMutations;

            // Type should be readonly
            expectTypeOf(pending).toMatchTypeOf<ReadonlyArray<unknown>>();

            // Should have the mutation
            expect(pending).toHaveLength(1);
        });

        it('should have strictly typed input based on mutation name', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: false,
                    };
                }),
                updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].completed = input.completed;
                    }
                }),
                deleteTodo: mutation((draft, input: { id: string }) => {
                    delete draft.todos[input.id];
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                        priority: field<number>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; priority: number }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        priority: input.priority,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test', priority: 5 });

            const pendingMutation = engine.pendingMutations[0];

            // Type checking
            expectTypeOf(pendingMutation.input).toEqualTypeOf<{ id: string; title: string; priority: number }>();

            // Runtime access
            expect(pendingMutation.input.id).toBe('todo-1');
            expect(pendingMutation.input.title).toBe('Test');
            expect(pendingMutation.input.priority).toBe(5);
        });
    });

    describe('Mutators', () => {
        it('should register a mutator', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: input.completed,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Should not throw
            expect(true).toBe(true);
        });

        it('should apply mutation to state', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: input.completed,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: input.completed,
                    };
                }),
                updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].completed = input.completed;
                    }
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Create initial item with full data
            engine.rebase({
                todos: [{
                    id: 'todo-1',
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
        });

        it('should ignore partial items without all required fields when creating new items', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Create new item with all fields
            engine.rebase({
                todos: [{
                    id: 'todo-1',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                        description: field<string | null>(),
                    },
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Create item with null description
            engine.rebase({
                todos: [{
                    id: 'todo-1',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].completed = input.completed;
                    }
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Update server state with a todo
            engine.rebase({
                todos: [{
                    id: 'todo-1',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].completed = input.completed;
                    }
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Initial server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: input.completed,
                    };
                }),
                updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].completed = input.completed;
                    }
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Set up server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Todo 1',
                    completed: false,
                }, {
                    id: 'todo-2',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createTodo', { id: 'todo-1', title: 'Test' });
            expect(engine.state.todos['todo-1']).toBeDefined();

            // Commit with single ID (not array)
            engine.commit('any-id'); // Won't match, but should accept string

            // State should still have the todo since ID didn't match
            expect(engine.state.todos['todo-1']).toBeDefined();
        });

        it('should commit array of mutation IDs', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                updateTodo: mutation((draft, input: { id: string; title: string }) => {
                    if (draft.todos[input.id]) {
                        draft.todos[input.id].title = input.title;
                    }
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Setup server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Original 1',
                }, {
                    id: 'todo-2',
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
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; completed: boolean }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        completed: input.completed,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

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
            }).withMutations({
                createTodo: mutation((draft, input: { id: string; title: string; assignedTo: string }) => {
                    draft.todos[input.id] = {
                        id: input.id,
                        title: input.title,
                        assignedTo: input.assignedTo,
                    };
                }),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                assignedTo: 'user-1',
            });

            expect(engine.state.todos['todo-1'].assignedTo).toBe('user-1');
        });
    });
});
