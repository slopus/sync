/**
 * Tests for Mutation definitions in Schema DSL
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
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
            createTodo: mutation(
                z.object({
                    title: z.string(),
                    completed: z.boolean().default(false),
                }),
                (draft, input) => {}
            ),
            updateTodo: mutation(
                z.object({
                    id: z.string(),
                    title: z.string().optional(),
                    completed: z.boolean().optional(),
                }),
                (draft, input) => {}
            ),
            deleteTodo: mutation(
                z.object({
                    id: z.string(),
                }),
                (draft, input) => {}
            ),
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
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
        });

        const mutationDescriptor = schema.mutation('createTodo');
        expect(mutationDescriptor).toBeDefined();
        expect(mutationDescriptor.schema).toBeDefined();
        expect(mutationDescriptor.handler).toBeDefined();

        // Validate that it's a proper Zod schema
        const result = mutationDescriptor.schema.parse({ title: 'Test' });
        expect(result).toEqual({ title: 'Test' });
    });

    it('should list all mutation names', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
            updateTodo: mutation(
                z.object({ id: z.string() }),
                (draft, input) => {}
            ),
            deleteTodo: mutation(
                z.object({ id: z.string() }),
                (draft, input) => {}
            ),
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
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
        });

        // Should be able to access existing mutation
        const mutationDescriptor = schema.mutation('createTodo');
        expect(mutationDescriptor).toBeDefined();
        expect(mutationDescriptor.schema).toBeDefined();
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
                z.object({
                    title: z.string(),
                    completed: z.boolean(),
                }),
                (draft, input) => {}
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
                z.object({
                    title: z.string(),
                    completed: z.boolean().default(false),
                }),
                (draft, input) => {}
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
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
            updateTodo: mutation(
                z.object({ id: z.string() }),
                (draft, input) => {}
            ),
            deleteTodo: mutation(
                z.object({ id: z.string() }),
                (draft, input) => {}
            ),
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
                z.object({
                    title: z.string(),
                    metadata: z.object({
                        tags: z.array(z.string()),
                        priority: z.number(),
                    }),
                }),
                (draft, input) => {}
            ),
        });

        const mutationDescriptor = schema.mutation('createTodoWithMetadata');
        const result = mutationDescriptor.schema.parse({
            title: 'Test',
            metadata: {
                tags: ['work', 'urgent'],
                priority: 1,
            },
        });

        expect(result.title).toBe('Test');
        expect(result.metadata.tags).toEqual(['work', 'urgent']);
        expect(result.metadata.priority).toBe(1);

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
            create: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
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
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
        }).withMutations({
            updateTodo: mutation(
                z.object({ id: z.string() }),
                (draft, input) => {}
            ),
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
            createTodo: mutation(
                z.object({ title: z.string() }),
                (draft, input) => {}
            ),
        });

        expect(() => {
            schema.withMutations({
                createTodo: mutation(
                    z.object({ title: z.string() }),
                    (draft, input) => {}
                ),
            });
        }).toThrow("Mutation 'createTodo' already exists");
    });
});
