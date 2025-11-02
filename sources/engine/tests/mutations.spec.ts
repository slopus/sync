/**
 * Tests for Mutation definitions in Schema DSL
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    object,
    field,
    mutation,
    syncEngine,
    type InferMutationInput,
    type InferMutationOutput,
    type InferMutations,
} from '../index';

describe('Schema Mutations', () => {
    it('should define a schema with mutations', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                    completed: field<boolean>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string; completed?: boolean }) => {}),
            updateTodo: mutation((draft, input: { id: string; title?: string; completed?: boolean }) => {}),
            deleteTodo: mutation((draft, input: { id: string }) => {}),
        });

        expect(schema._schema.types.todos).toBeDefined();
        expect(schema._schema.mutations).toBeDefined();
    });

    it('should access mutation descriptors', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
        });

        const mutationDescriptor = schema.mutation('createTodo');
        expect(mutationDescriptor).toBeDefined();
        expect(mutationDescriptor.handler).toBeDefined();
        expect(typeof mutationDescriptor.handler).toBe('function');
    });

    it('should list all mutation names', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
            updateTodo: mutation((draft, input: { id: string }) => {}),
            deleteTodo: mutation((draft, input: { id: string }) => {}),
        });

        const mutationNames = schema.mutations();
        expect(mutationNames).toHaveLength(3);
        expect(mutationNames).toContain('createTodo');
        expect(mutationNames).toContain('updateTodo');
        expect(mutationNames).toContain('deleteTodo');
    });

    it('should handle accessing mutations correctly', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
        });

        // Should be able to access existing mutation
        const mutationDescriptor = schema.mutation('createTodo');
        expect(mutationDescriptor).toBeDefined();
    });

    it('should work with schemas without mutations', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        });

        expect(schema._schema.types.todos).toBeDefined();

        const mutationNames = schema.mutations();
        expect(mutationNames).toHaveLength(0);
    });

    it('should infer mutation input types correctly', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation(
                (draft, input: { title: string; completed: boolean }) => {}
            ),
        });

        type CreateInput = InferMutationInput<typeof schema, 'createTodo'>;

        expectTypeOf<CreateInput>().toEqualTypeOf<{
            title: string;
            completed: boolean;
        }>();
    });

    it('should infer mutation output types correctly with defaults', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation(
                (draft, input: { title: string; completed?: boolean }) => {}
            ),
        });

        type CreateOutput = InferMutationOutput<typeof schema, 'createTodo'>;

        expectTypeOf<CreateOutput>().toEqualTypeOf<{
            title: string;
            completed?: boolean;
        }>();
    });

    it('should infer all mutation names as union type', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
            updateTodo: mutation((draft, input: { id: string }) => {}),
            deleteTodo: mutation((draft, input: { id: string }) => {}),
        });

        type Mutations = InferMutations<typeof schema>;

        expectTypeOf<Mutations>().toEqualTypeOf<'createTodo' | 'updateTodo' | 'deleteTodo'>();
    });

    it('should handle complex mutation schemas with nested objects', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodoWithMetadata: mutation(
                (draft, input: { title: string; metadata: { tags: string[]; priority: number } }) => {}
            ),
        });

        const mutationDescriptor = schema.mutation('createTodoWithMetadata');
        expect(mutationDescriptor).toBeDefined();

        type Input = InferMutationInput<typeof schema, 'createTodoWithMetadata'>;
        expectTypeOf<Input>().toEqualTypeOf<{
            title: string;
            metadata: {
                tags: string[];
                priority: number;
            };
        }>();
    });

    it('should handle schemas with and without mutations', () => {
        // Schema with mutations
        const withMutations = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            create: mutation((draft, input: { title: string }) => {}),
        });

        // Schema without mutations
        const withoutMutations = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        });

        expect(withMutations._schema.mutations).toBeDefined();
        expect(Object.keys(withMutations._schema.mutations).length).toBe(1);

        expect(withoutMutations._schema.mutations).toBeDefined();
        expect(Object.keys(withoutMutations._schema.mutations).length).toBe(0);
    });

    it('should support chaining multiple withMutations calls', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
        }).withMutations({
            updateTodo: mutation((draft, input: { id: string }) => {}),
        });

        const mutationNames = schema.mutations();
        expect(mutationNames).toHaveLength(2);
        expect(mutationNames).toContain('createTodo');
        expect(mutationNames).toContain('updateTodo');
    });

    it('should throw error when adding duplicate mutation names', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string }) => {}),
        });

        expect(() => {
            schema.withMutations({
                createTodo: mutation((draft, input: { title: string }) => {}),
            });
        }).toThrow("Mutation 'createTodo' already exists");
    });

    it('should support direct mutations that apply without queueing', () => {
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

        // Normal mutation - should add to pending queue
        engine.mutate('createTodo', { id: '1', title: 'Test Todo', completed: false });
        expect(engine.pendingMutations).toHaveLength(1);
        expect(engine.state.todos['1']).toEqual({
            id: '1',
            title: 'Test Todo',
            completed: false,
        });

        // Direct mutation - should NOT add to pending queue
        engine.mutate('updateTodo', { id: '1', completed: true }, { direct: true });
        expect(engine.pendingMutations).toHaveLength(1); // Still only the createTodo mutation
        expect(engine.state.todos['1'].completed).toBe(true);

        // Verify the mutation was applied directly
        expect(engine.state.todos['1']).toEqual({
            id: '1',
            title: 'Test Todo',
            completed: true,
        });
    });

    it('should handle direct mutations with collections', () => {
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
            deleteTodo: mutation((draft, input: { id: string }) => {
                delete draft.todos[input.id];
            }),
        });

        const engine = syncEngine(schema, { from: 'new' });

        // Create a todo normally
        engine.mutate('createTodo', { id: '1', title: 'Test' });
        expect(engine.pendingMutations).toHaveLength(1);

        // Delete using direct mutation
        engine.mutate('deleteTodo', { id: '1' }, { direct: true });
        expect(engine.pendingMutations).toHaveLength(1); // Still only the createTodo mutation
        expect(engine.state.todos['1']).toBeUndefined();
    });

    it('should handle direct mutations with singleton objects', () => {
        const schema = defineSchema({
            settings: object({
                fields: {
                    theme: field<string>(),
                    fontSize: field<number>(),
                },
            }),
        }).withMutations({
            updateTheme: mutation((draft, input: { theme: string }) => {
                draft.settings.theme = input.theme;
            }),
            updateFontSize: mutation((draft, input: { fontSize: number }) => {
                draft.settings.fontSize = input.fontSize;
            }),
        });

        const engine = syncEngine(schema, {
            from: 'new',
            objects: {
                settings: { theme: 'light', fontSize: 14 },
            },
        });

        // Normal mutation
        engine.mutate('updateTheme', { theme: 'dark' });
        expect(engine.pendingMutations).toHaveLength(1);
        expect(engine.state.settings.theme).toBe('dark');

        // Direct mutation
        engine.mutate('updateFontSize', { fontSize: 16 }, { direct: true });
        expect(engine.pendingMutations).toHaveLength(1); // Still only the updateTheme mutation
        expect(engine.state.settings.fontSize).toBe(16);
    });

    it('should not affect server state with direct mutations', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    completed: field<boolean>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { id: string; completed: boolean }) => {
                draft.todos[input.id] = { id: input.id, completed: input.completed };
            }),
            toggleTodo: mutation((draft, input: { id: string }) => {
                if (draft.todos[input.id]) {
                    draft.todos[input.id].completed = !draft.todos[input.id].completed;
                }
            }),
        });

        const engine = syncEngine(schema, { from: 'new' });

        // Create a todo normally
        engine.mutate('createTodo', { id: '1', completed: false });

        // Simulate server confirming the mutation
        engine.rebase({
            todos: [{ id: '1', completed: false }],
        });

        // Commit the mutation
        const mutationId = engine.pendingMutations[0].id;
        engine.commit(mutationId);

        // Verify server state
        expect(engine.serverState.todos['1'].completed).toBe(false);

        // Toggle using direct mutation
        engine.mutate('toggleTodo', { id: '1' }, { direct: true });

        // Client state should be updated
        expect(engine.state.todos['1'].completed).toBe(true);

        // Server state should remain unchanged
        expect(engine.serverState.todos['1'].completed).toBe(false);
    });
});
