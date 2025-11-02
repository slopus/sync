/**
 * Tests for InferSchema type helper
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    defineSchema,
    type,
    field,
    mutation,
    type InferSchema,
} from '../index';

describe('InferSchema', () => {
    it('should infer the full schema definition including types and mutations', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                    completed: field<boolean>(),
                },
            }),
            users: type({
                fields: {
                    name: field<string>(),
                    email: field<string>(),
                },
            }),
        }).withMutations({
            createTodo: mutation((draft, input: { title: string; completed: boolean }) => {}),
            updateTodo: mutation((draft, input: { id: string; completed: boolean }) => {}),
        });

        type SchemaType = InferSchema<typeof schema>;

        // Verify that the inferred type has both 'types' and 'mutations'
        type HasTypes = 'types' extends keyof SchemaType ? true : false;
        type HasMutations = 'mutations' extends keyof SchemaType ? true : false;

        const hasTypes: HasTypes = true;
        const hasMutations: HasMutations = true;

        expect(hasTypes).toBe(true);
        expect(hasMutations).toBe(true);

        // Verify types are accessible
        type TodosType = SchemaType['types']['todos'];
        expectTypeOf<TodosType>().not.toBeNever();

        type UsersType = SchemaType['types']['users'];
        expectTypeOf<UsersType>().not.toBeNever();

        // Verify mutations are accessible
        type Mutations = SchemaType['mutations'];
        expectTypeOf<Mutations>().not.toBeNever();

        type CreateTodoMutation = SchemaType['mutations']['createTodo'];
        expectTypeOf<CreateTodoMutation>().not.toBeNever();

        type UpdateTodoMutation = SchemaType['mutations']['updateTodo'];
        expectTypeOf<UpdateTodoMutation>().not.toBeNever();
    });

    it('should work with schemas without mutations', () => {
        const schema = defineSchema({
            todos: type({
                fields: {
                    title: field<string>(),
                },
            }),
        });

        type SchemaType = InferSchema<typeof schema>;

        // Verify that the inferred type has both 'types' and 'mutations' (even if mutations is empty)
        type HasTypes = 'types' extends keyof SchemaType ? true : false;
        type HasMutations = 'mutations' extends keyof SchemaType ? true : false;

        const hasTypes: HasTypes = true;
        const hasMutations: HasMutations = true;

        expect(hasTypes).toBe(true);
        expect(hasMutations).toBe(true);

        // Mutations should be an empty object
        type Mutations = SchemaType['mutations'];
        expectTypeOf<Mutations>().toEqualTypeOf<{}>();
    });

    it('should preserve the exact structure from the schema definition', () => {
        const schema = defineSchema({
            posts: type({
                fields: {
                    title: field<string>(),
                    content: field<string>(),
                },
                versioned: true,
            }),
        }).withMutations({
            createPost: mutation((draft, input: { title: string; content: string }) => {}),
        });

        type SchemaType = InferSchema<typeof schema>;

        // Access specific parts of the schema
        type PostsType = SchemaType['types']['posts'];
        type PostsFields = PostsType extends { fields: infer F } ? F : never;

        expectTypeOf<PostsFields>().not.toBeNever();

        // Verify mutations
        type CreatePostMutation = SchemaType['mutations']['createPost'];
        expectTypeOf<CreatePostMutation>().not.toBeNever();
    });
});
