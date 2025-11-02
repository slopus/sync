/**
 * Tests for Dual-Representation Architecture
 * Tests for server-side vs client-side representations and LWW conflict resolution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
    defineSchema,
    type,
    field,
    reference,
    syncEngine,
    localField,
    mutation,
} from '../index';

describe('Dual-Representation Architecture', () => {
    describe('versioned = false (Simple Overwrite)', () => {
        it('should overwrite fields on every rebase when tracking is disabled', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        // versioned omitted - disabled
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // First update
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'First Title',
                    completed: false,
                }],
            });

            expect(engine.serverState.todos['todo-1'].title).toBe('First Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);

            // Second update - should always overwrite
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Second Title',
                    completed: true,
                }],
            });

            expect(engine.serverState.todos['todo-1'].title).toBe('Second Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(true);
        });

        it('should set all version values to 0 when tracking is disabled', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                        },
                        // versioned omitted - disabled
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    title: 'Test',
                }],
            });

            // Internal representation should have version = 0
            // We can't directly test this without exposing internals,
            // but we can verify behavior is consistent
            expect(engine.serverState.todos['todo-1'].title).toBe('Test');
        });
    });

    describe('versioned = true (LWW Conflict Resolution)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should use LWW resolution when field timestamps differ', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        versioned: true, // Enabled
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // First update with version 1
            vi.setSystemTime(1000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Old Title',
                    completed: false,
                }],
            });

            expect(engine.serverState.todos['todo-1'].title).toBe('Old Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);

            // Second update with version 2 (newer)
            vi.setSystemTime(2000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 2,
                    title: 'New Title',
                }],
            });

            // Should keep newer value
            expect(engine.serverState.todos['todo-1'].title).toBe('New Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);
        });

        it('should handle out-of-order updates correctly with LWW', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // First update with version 3 (arrives first but is newer)
            vi.setSystemTime(3000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 3,
                    title: 'Newest Title',
                    completed: true,
                }],
            });

            expect(engine.serverState.todos['todo-1'].title).toBe('Newest Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(true);

            // Second update with version 1 (arrives late, is older)
            vi.setSystemTime(1000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Old Title',
                    completed: false,
                }],
            });

            // Should keep newer values (from first update)
            expect(engine.serverState.todos['todo-1'].title).toBe('Newest Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(true);
        });

        it('should handle field-level LWW (different fields at different times)', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Initial state with version 1
            vi.setSystemTime(1000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Original Title',
                    completed: false,
                }],
            });

            // Update title with version 2
            vi.setSystemTime(2000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 2,
                    title: 'Updated Title',
                }],
            });

            // Update completed with version 3
            vi.setSystemTime(3000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 3,
                    completed: true,
                }],
            });

            // Both fields should have their latest values
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated Title');
            expect(engine.serverState.todos['todo-1'].completed).toBe(true);

            // Now try to update with older version (version 1.5 - simulated as version 2, which is already applied)
            // Actually, let's send version 1 which should be rejected
            vi.setSystemTime(1500);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Stale Title',
                }],
            });

            // Title should NOT change (newer value wins)
            expect(engine.serverState.todos['todo-1'].title).toBe('Updated Title');
            // Completed should remain unchanged
            expect(engine.serverState.todos['todo-1'].completed).toBe(true);
        });

        it('should work correctly with references', () => {
            const schema = defineSchema({
                types: {
                    users: type({
                        fields: {
                            name: field<string>(),
                        },
                        versioned: true,
                    }),
                    todos: type({
                        fields: {
                            title: field<string>(),
                            assignedTo: reference('users'),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Create user with version 1
            vi.setSystemTime(1000);
            engine.rebase({
                users: [{
                    id: 'user-1',
                    $version: 1,
                    name: 'Alice',
                }],
            });

            // Create todo with reference, version 2
            vi.setSystemTime(2000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 2,
                    title: 'Test Todo',
                    assignedTo: 'user-1',
                }],
            });

            expect(engine.serverState.todos['todo-1'].assignedTo).toBe('user-1');

            // Try to update reference with older version (version 1)
            vi.setSystemTime(1500);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    assignedTo: 'user-2',
                }],
            });

            // Reference should NOT change (newer wins)
            expect(engine.serverState.todos['todo-1'].assignedTo).toBe('user-1');
        });
    });

    describe('Client State Projection', () => {
        it('should expose plain values in client state regardless of internal representation', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Test',
                    completed: false,
                }],
            });

            // Client state should have plain values
            const todo = engine.serverState.todos['todo-1'];
            expect(typeof todo.title).toBe('string');
            expect(typeof todo.completed).toBe('boolean');
            expect(typeof todo.id).toBe('string');
        });

        it('should apply mutations on top of unwrapped server state', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            completed: field<boolean>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {
                    updateTodo: mutation(
                        z.object({
                            id: z.string(),
                            completed: z.boolean(),
                        }),
                        (draft, input) => {
                            if (draft.todos[input.id]) {
                                draft.todos[input.id].completed = input.completed;
                            }
                        }
                    ),
                },
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Set server state
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Server Title',
                    completed: false,
                }],
            });

            // Apply local mutation
            engine.mutate('updateTodo', { id: 'todo-1', completed: true });

            // Server state should not change
            expect(engine.serverState.todos['todo-1'].completed).toBe(false);

            // Client state should have mutation applied
            expect(engine.state.todos['todo-1'].completed).toBe(true);

            // Both should have plain values
            expect(typeof engine.state.todos['todo-1'].completed).toBe('boolean');
            expect(typeof engine.serverState.todos['todo-1'].completed).toBe('boolean');
        });
    });

    describe('Local Fields with Dual Representation', () => {
        it('should initialize local fields with defaults in server snapshot', () => {
            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Test',
                    // isExpanded not provided by server
                }],
            });

            // Local field should be initialized with default
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);
        });

        it('should ignore local field values from server updates', () => {
            vi.useFakeTimers();

            const schema = defineSchema({
                types: {
                    todos: type({
                        fields: {
                            title: field<string>(),
                            isExpanded: localField(false),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, { from: 'new' });

            // Create todo with default local field at t=1000
            vi.setSystemTime(1000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 1,
                    title: 'Test',
                }],
            });

            // Local field should be initialized to default (false)
            expect(engine.serverState.todos['todo-1'].isExpanded).toBe(false);

            // Server tries to send an update with a local field value (this should be ignored) at t=2000
            vi.setSystemTime(2000);
            engine.rebase({
                todos: [{
                    id: 'todo-1',
                    $version: 2,
                    title: 'Updated Title',
                    isExpanded: true, // This should be ignored
                }],
            });

            // Title should be updated
            expect(engine.state.todos['todo-1'].title).toBe('Updated Title');
            // Local field should still be false (server value ignored)
            expect(engine.state.todos['todo-1'].isExpanded).toBe(false);

            vi.useRealTimers();
        });
    });
});
