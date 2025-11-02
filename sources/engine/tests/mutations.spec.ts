/**
 * Tests for Mutation definitions in Schema DSL
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    field,
    mutation,
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
            completed: boolean;
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
});
