/**
 * Tests for Persistence
 */

import { describe, it, expect } from 'vitest';
import {
    defineSchema,
    type,
    object,
    field,
    localField,
    syncEngine,
    mutation,
} from '../index';

describe('Persistence', () => {
    describe('persist() and restore', () => {
        it('should persist and restore empty state', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string; completed: boolean }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                            completed: input.completed,
                        };
                    }
                ),
            });

            // Create engine with empty state
            const engine1 = syncEngine(schema, { from: 'new', objects: {} });

            // Persist state
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify state matches
            expect(engine2.state.todos).toEqual({});
            expect(engine2.serverState.todos).toEqual({});
            expect(engine2.pendingMutations).toEqual([]);
        });

        it('should persist and restore state with collections', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string; completed: boolean }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                            completed: input.completed,
                        };
                    }
                ),
            });

            // Create engine
            const engine1 = syncEngine(schema, { from: 'new', objects: {} });

            // Apply mutation
            engine1.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });

            // Simulate server confirming the mutation
            const mutationId = engine1.pendingMutations[0].id;
            engine1.rebase({
                todos: [
                    { id: 'todo-1', title: 'Test Todo', completed: false },
                ],
            });
            engine1.commit(mutationId);

            // Persist state
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify state matches
            expect(engine2.state.todos['todo-1']).toEqual({
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });
            expect(engine2.serverState.todos['todo-1']).toEqual({
                id: 'todo-1',
                title: 'Test Todo',
                completed: false,
            });
            expect(engine2.pendingMutations).toEqual([]);
        });

        it('should persist and restore pending mutations', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string; completed: boolean }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                            completed: input.completed,
                        };
                    }
                ),
            });

            // Create engine
            const engine1 = syncEngine(schema, { from: 'new', objects: {} });

            // Apply mutations
            engine1.mutate('createTodo', {
                id: 'todo-1',
                title: 'First Todo',
                completed: false,
            });
            engine1.mutate('createTodo', {
                id: 'todo-2',
                title: 'Second Todo',
                completed: true,
            });

            // Persist state with pending mutations
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify pending mutations were restored
            expect(engine2.pendingMutations).toHaveLength(2);
            expect(engine2.pendingMutations[0].name).toBe('createTodo');
            expect(engine2.pendingMutations[0].input).toEqual({
                id: 'todo-1',
                title: 'First Todo',
                completed: false,
            });
            expect(engine2.pendingMutations[1].name).toBe('createTodo');
            expect(engine2.pendingMutations[1].input).toEqual({
                id: 'todo-2',
                title: 'Second Todo',
                completed: true,
            });

            // Verify state includes pending mutations
            expect(engine2.state.todos['todo-1']).toEqual({
                id: 'todo-1',
                title: 'First Todo',
                completed: false,
            });
            expect(engine2.state.todos['todo-2']).toEqual({
                id: 'todo-2',
                title: 'Second Todo',
                completed: true,
            });

            // Server state should be empty (mutations not confirmed)
            expect(engine2.serverState.todos).toEqual({});
        });

        it('should persist and restore singleton objects', () => {
            const schema = defineSchema({
                settings: object({
                    fields: {
                        theme: field<string>(),
                        notifications: field<boolean>(),
                    },
                }),
            }).withMutations({
                updateTheme: mutation(
                    (draft, input: { theme: string }) => {
                        draft.settings.theme = input.theme;
                    }
                ),
            });

            // Create engine with initial object values
            const engine1 = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                        notifications: true,
                    },
                },
            });

            // Persist state
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify singleton object was restored
            expect(engine2.state.settings).toEqual({
                theme: 'dark',
                notifications: true,
            });
            expect(engine2.serverState.settings).toEqual({
                theme: 'dark',
                notifications: true,
            });
        });

        it('should persist and restore versioned collections', () => {
            const schema = defineSchema({
                todos: type({
                    versioned: true,
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                        };
                    }
                ),
            });

            // Create engine and add data with version from server
            const engine1 = syncEngine(schema, { from: 'new', objects: {} });
            engine1.rebase({
                todos: [
                    { id: 'todo-1', title: 'Test', $version: 5 },
                ],
            });

            // Persist state
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify version was preserved
            expect(engine2.state.todos['todo-1'].$version).toBe(5);
        });

        it('should persist and restore local fields', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        localNote: localField<string>(''),
                    },
                }),
            }).withMutations({
                setLocalNote: mutation(
                    (draft, input: { id: string; note: string }) => {
                        draft.todos[input.id].localNote = input.note;
                    }
                ),
            });

            // Create engine with server data
            const engine1 = syncEngine(schema, { from: 'new', objects: {} });
            engine1.rebase({
                todos: [{ id: 'todo-1', title: 'Test Todo' }],
            });

            // Update local field
            engine1.mutate('setLocalNote', { id: 'todo-1', note: 'Local note' });

            // Persist state
            const persisted = engine1.persist();

            // Restore from persisted state
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify local field was preserved in pending mutations
            expect(engine2.state.todos['todo-1'].localNote).toBe('Local note');
        });

        it('should work with legacy initialization signature', () => {
            const schema = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                }),
            }).withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                        };
                    }
                ),
            });

            // Create engine using legacy signature (backward compatibility)
            const engine = syncEngine(schema, { from: 'new' });

            expect(engine.state.todos).toEqual({});
            expect(engine.serverState.todos).toEqual({});
        });

        it('should handle complex state with multiple collections and objects', () => {
            const schema = defineSchema({
                users: type({
                    versioned: true,
                    fields: {
                        name: field<string>(),
                        email: field<string>(),
                    },
                }),
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        userId: field<string>(),
                    },
                }),
                settings: object({
                    fields: {
                        theme: field<string>(),
                    },
                }),
            }).withMutations({
                createUser: mutation(
                    (draft, input: { id: string; name: string; email: string }) => {
                        draft.users[input.id] = {
                            id: input.id,
                            name: input.name,
                            email: input.email,
                        };
                    }
                ),
                createTodo: mutation(
                    (draft, input: { id: string; title: string; userId: string }) => {
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                            completed: false,
                            userId: input.userId,
                        };
                    }
                ),
            });

            // Create engine with complex state
            const engine1 = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: { theme: 'light' },
                },
            });

            // Add data from server (with version from server)
            engine1.rebase({
                users: [
                    { id: 'user-1', name: 'Alice', email: 'alice@example.com', $version: 1 },
                ],
            });

            // Add pending mutations
            engine1.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test',
                userId: 'user-1',
            });

            // Persist and restore
            const persisted = engine1.persist();
            const engine2 = syncEngine(schema, { from: 'restore', data: persisted });

            // Verify all data was restored correctly (version preserved from server)
            expect(engine2.state.users['user-1']).toEqual({
                id: 'user-1',
                name: 'Alice',
                email: 'alice@example.com',
                $version: 1,
            });
            expect(engine2.state.todos['todo-1']).toEqual({
                id: 'todo-1',
                title: 'Test',
                completed: false,
                userId: 'user-1',
            });
            expect(engine2.state.settings).toEqual({ theme: 'light' });
            expect(engine2.pendingMutations).toHaveLength(1);
        });
    });
});
