/**
 * Tests for Mutation definitions in Schema DSL
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
    defineSchema,
    type,
    mutableField,
    type InferMutationInput,
    type InferMutationOutput,
    type InferMutations,
} from '../index';

describe('Schema Mutations', () => {
    it('should define a schema with mutations', () => {
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
                    title: z.string(),
                    completed: z.boolean().default(false),
                }),
                updateTodo: z.object({
                    id: z.string(),
                    title: z.string().optional(),
                    completed: z.boolean().optional(),
                }),
                deleteTodo: z.object({
                    id: z.string(),
                }),
            },
        });

        expect(schema._schema.types.todos).toBeDefined();
        expect(schema._schema.mutations).toBeDefined();
    });

    it('should access mutation schemas', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
            mutations: {
                createTodo: z.object({ title: z.string() }),
            },
        });

        const mutation = schema.mutation('createTodo');
        expect(mutation).toBeDefined();

        // Validate that it's a proper Zod schema
        const result = mutation.parse({ title: 'Test' });
        expect(result).toEqual({ title: 'Test' });
    });

    it('should list all mutation names', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
            mutations: {
                createTodo: z.object({ title: z.string() }),
                updateTodo: z.object({ id: z.string() }),
                deleteTodo: z.object({ id: z.string() }),
            },
        });

        const mutationNames = schema.mutations();
        expect(mutationNames).toHaveLength(3);
        expect(mutationNames).toContain('createTodo');
        expect(mutationNames).toContain('updateTodo');
        expect(mutationNames).toContain('deleteTodo');
    });

    it('should throw error when accessing mutations on schema without mutations', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
        });

        expect(() => schema.mutation('nonexistent' as never)).toThrow(
            'Mutations are not defined in this schema'
        );
    });

    it('should work with old schema format (backward compatibility)', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: mutableField<string>(),
                },
            }),
        });

        expect(schema._schema.types.todos).toBeDefined();
        expect(schema._schema.mutations).toBeUndefined();

        const mutationNames = schema.mutations();
        expect(mutationNames).toHaveLength(0);
    });

    it('should infer mutation input types correctly', () => {
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
                    title: z.string(),
                    completed: z.boolean(),
                }),
            },
        });

        type CreateInput = InferMutationInput<typeof schema, 'createTodo'>;

        expectTypeOf<CreateInput>().toEqualTypeOf<{
            title: string;
            completed: boolean;
        }>();
    });

    it('should infer mutation output types correctly with defaults', () => {
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
                    title: z.string(),
                    completed: z.boolean().default(false),
                }),
            },
        });

        type CreateOutput = InferMutationOutput<typeof schema, 'createTodo'>;

        expectTypeOf<CreateOutput>().toEqualTypeOf<{
            title: string;
            completed: boolean;
        }>();
    });

    it('should infer all mutation names as union type', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
            mutations: {
                createTodo: z.object({ title: z.string() }),
                updateTodo: z.object({ id: z.string() }),
                deleteTodo: z.object({ id: z.string() }),
            },
        });

        type Mutations = InferMutations<typeof schema>;

        expectTypeOf<Mutations>().toEqualTypeOf<'createTodo' | 'updateTodo' | 'deleteTodo'>();
    });

    it('should handle complex mutation schemas with nested objects', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
            mutations: {
                createTodoWithMetadata: z.object({
                    title: z.string(),
                    metadata: z.object({
                        tags: z.array(z.string()),
                        priority: z.number(),
                    }),
                }),
            },
        });

        const mutation = schema.mutation('createTodoWithMetadata');
        const result = mutation.parse({
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

    it('should handle optional mutations field', () => {
        // Schema with mutations
        const withMutations = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: mutableField<string>(),
                    },
                }),
            },
            mutations: {
                create: z.object({ title: z.string() }),
            },
        });

        // Schema without mutations (old format)
        const withoutMutations = defineSchema({
            todos: type({
                fields: {
                    title: mutableField<string>(),
                },
            }),
        });

        expect(withMutations._schema.mutations).toBeDefined();
        // Old format schemas are wrapped in { types: ... } without mutations property
        expect('mutations' in withoutMutations._schema).toBe(false);
    });
});
