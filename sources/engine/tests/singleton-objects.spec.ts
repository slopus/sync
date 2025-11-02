/**
 * Tests for Singleton Objects
 * Tests for object() schema type with direct access (no key indexing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    defineSchema,
    type,
    object,
    field,
    syncEngine,
    localField,
} from '../index';

describe('Singleton Objects', () => {
    describe('Basic singleton functionality', () => {
        it('should create a singleton object with direct access', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                            fontSize: field<number>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                        fontSize: 14,
                    },
                },
            });

            // Rebase with singleton data (no id, single object)
            engine.rebase({
                settings: {
                    theme: 'dark',
                    fontSize: 14,
                },
            });

            // Access singleton directly (no key indexing)
            expect(engine.serverState.settings.theme).toBe('dark');
            expect(engine.serverState.settings.fontSize).toBe(14);
        });

        it('should update singleton fields with partial updates', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                            fontSize: field<number>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'light',
                        fontSize: 12,
                    },
                },
            });

            // Initial rebase
            engine.rebase({
                settings: {
                    theme: 'light',
                    fontSize: 12,
                },
            });

            // Partial update (only theme)
            engine.rebase({
                settings: {
                    theme: 'dark',
                },
            });

            // Theme should be updated, fontSize should remain
            expect(engine.serverState.settings.theme).toBe('dark');
            expect(engine.serverState.settings.fontSize).toBe(12);
        });

        it('should work with mixed schema (collections + singletons)', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                        },
                    }),
                    todos: type({
                        fields: {
                            title: field<string>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                    },
                },
            });

            engine.rebase({
                settings: {
                    theme: 'dark',
                },
                todos: [{
                    id: 'todo-1',
                    title: 'Task 1',
                }],
            });

            // Access singleton directly
            expect(engine.serverState.settings.theme).toBe('dark');

            // Access collection with key
            expect(engine.serverState.todos['todo-1'].title).toBe('Task 1');
        });
    });

    describe('Versioning with singletons', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should use LWW resolution for versioned singleton', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                            fontSize: field<number>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'light',
                        fontSize: 12,
                    },
                },
            });

            // First update with version 1
            vi.setSystemTime(1000);
            engine.rebase({
                settings: {
                    $version: 1,
                    theme: 'light',
                    fontSize: 12,
                },
            });

            expect(engine.serverState.settings.theme).toBe('light');
            expect(engine.serverState.settings.fontSize).toBe(12);

            // Second update with version 2 (newer)
            vi.setSystemTime(2000);
            engine.rebase({
                settings: {
                    $version: 2,
                    theme: 'dark',
                },
            });

            // Should keep newer value
            expect(engine.serverState.settings.theme).toBe('dark');
            expect(engine.serverState.settings.fontSize).toBe(12);
        });

        it('should reject older versions with LWW', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<string>(),
                        },
                        versioned: true,
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                    },
                },
            });

            // Update with version 3 (arrives first but is newer)
            vi.setSystemTime(3000);
            engine.rebase({
                settings: {
                    $version: 3,
                    theme: 'dark',
                },
            });

            expect(engine.serverState.settings.theme).toBe('dark');

            // Update with version 1 (arrives late, is older)
            vi.setSystemTime(1000);
            engine.rebase({
                settings: {
                    $version: 1,
                    theme: 'light',
                },
            });

            // Should keep newer value
            expect(engine.serverState.settings.theme).toBe('dark');
        });
    });

    describe('Local fields with singletons', () => {
        it('should initialize local fields with defaults in singleton', () => {
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

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                    },
                },
            });

            engine.rebase({
                settings: {
                    theme: 'dark',
                    // isExpanded not provided by server
                },
            });

            // Local field should be initialized with default
            expect(engine.serverState.settings.isExpanded).toBe(false);
        });

        it('should ignore local field values from server updates', () => {
            vi.useFakeTimers();

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

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'light',
                    },
                },
            });

            // Create singleton with default local field
            vi.setSystemTime(1000);
            engine.rebase({
                settings: {
                    theme: 'light',
                },
            });

            // Local field should be initialized to default (false)
            expect(engine.serverState.settings.isExpanded).toBe(false);

            // Server tries to send an update with a local field value (this should be ignored)
            vi.setSystemTime(2000);
            engine.rebase({
                settings: {
                    theme: 'dark',
                    isExpanded: true, // This should be ignored
                },
            });

            // Theme should be updated
            expect(engine.state.settings.theme).toBe('dark');
            // Local field should still be false (server value ignored)
            expect(engine.state.settings.isExpanded).toBe(false);

            vi.useRealTimers();
        });
    });

    describe('Type safety', () => {
        it('should enforce correct types for singleton access', () => {
            const schema = defineSchema({
                types: {
                    settings: object({
                        fields: {
                            theme: field<'light' | 'dark'>(),
                            fontSize: field<number>(),
                        },
                    }),
                },
                mutations: {},
            });

            const engine = syncEngine(schema, {
                from: 'new',
                objects: {
                    settings: {
                        theme: 'dark',
                        fontSize: 14,
                    },
                },
            });

            engine.rebase({
                settings: {
                    theme: 'dark',
                    fontSize: 14,
                },
            });

            // TypeScript should infer correct types
            const theme: 'light' | 'dark' = engine.serverState.settings.theme;
            const fontSize: number = engine.serverState.settings.fontSize;

            expect(theme).toBe('dark');
            expect(fontSize).toBe(14);
        });
    });
});
