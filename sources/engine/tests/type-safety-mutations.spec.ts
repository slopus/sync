/**
 * Tests for Type Safety in Mutation Handlers
 * Verifies that defineTypes().withMutations() provides full type safety
 */

import { describe, it, expect } from 'vitest';
import {
    defineSchema,
    type,
    field,
    localField,
    syncEngine,
    mutation,
} from '../index';

describe('Type Safety in Mutations', () => {
    describe('defineSchema().withMutations()', () => {
        it('should provide full type safety for draft parameter', () => {
            // Step 1: Define types
            const types = defineSchema({
                todos: type({
                    fields: {
                        title: field<string>(),
                        completed: field<boolean>(),
                        priority: field<number>(),
                    },
                }),
                users: type({
                    fields: {
                        name: field<string>(),
                        email: field<string>(),
                    },
                }),
            });

            // Step 2: Add mutations with fully typed draft parameter
            const schema = types.withMutations({
                createTodo: mutation(
                    (draft, input: { id: string; title: string; priority: number }) => {
                        // draft should have full type safety here
                        // draft.todos, draft.users should autocomplete
                        draft.todos[input.id] = {
                            id: input.id,
                            title: input.title,
                            completed: false,
                            priority: input.priority,
                        };
                    }
                ),
                updateTodo: mutation(
                    (draft, input: { id: string; completed: boolean }) => {
                        if (draft.todos[input.id]) {
                            draft.todos[input.id].completed = input.completed;
                        }
                    }
                ),
                createUser: mutation(
                    (draft, input: { id: string; name: string; email: string }) => {
                        draft.users[input.id] = {
                            id: input.id,
                            name: input.name,
                            email: input.email,
                        };
                    }
                ),
            });

            // Create engine
            const engine = syncEngine(schema, { from: 'new' });

            // Apply mutations
            engine.mutate('createTodo', {
                id: 'todo-1',
                title: 'Test Todo',
                priority: 5,
            });

            engine.mutate('createUser', {
                id: 'user-1',
                name: 'Alice',
                email: 'alice@example.com',
            });

            engine.mutate('updateTodo', {
                id: 'todo-1',
                completed: true,
            });

            // Verify state
            expect(engine.state.todos['todo-1']).toEqual({
                id: 'todo-1',
                title: 'Test Todo',
                completed: true,
                priority: 5,
            });

            expect(engine.state.users['user-1']).toEqual({
                id: 'user-1',
                name: 'Alice',
                email: 'alice@example.com',
            });
        });

        it('should work with local fields', () => {
            const types = defineSchema({
                items: type({
                    fields: {
                        name: field<string>(),
                        isExpanded: localField(false),
                        isSelected: localField(false),
                    },
                }),
            });

            const schema = types.withMutations({
                createItem: mutation(
                    (draft, input: { id: string; name: string }) => {
                        draft.items[input.id] = {
                            id: input.id,
                            name: input.name,
                            isExpanded: false,
                            isSelected: false,
                        };
                    }
                ),
                toggleExpanded: mutation(
                    (draft, input: { id: string }) => {
                        if (draft.items[input.id]) {
                            draft.items[input.id].isExpanded = !draft.items[input.id].isExpanded;
                        }
                    }
                ),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createItem', { id: 'item-1', name: 'Test Item' });
            engine.mutate('toggleExpanded', { id: 'item-1' });

            expect(engine.state.items['item-1'].isExpanded).toBe(true);
        });

        it('should work with multiple collection types', () => {
            const types = defineSchema({
                posts: type({
                    fields: {
                        title: field<string>(),
                        content: field<string>(),
                        authorId: field<string>(),
                    },
                }),
                comments: type({
                    fields: {
                        postId: field<string>(),
                        text: field<string>(),
                        authorId: field<string>(),
                    },
                }),
                authors: type({
                    fields: {
                        name: field<string>(),
                    },
                }),
            });

            const schema = types.withMutations({
                createPost: mutation(
                    (draft, input: { id: string; title: string; content: string; authorId: string }) => {
                        draft.posts[input.id] = {
                            id: input.id,
                            title: input.title,
                            content: input.content,
                            authorId: input.authorId,
                        };
                    }
                ),
                addComment: mutation(
                    (draft, input: { id: string; postId: string; text: string; authorId: string }) => {
                        draft.comments[input.id] = {
                            id: input.id,
                            postId: input.postId,
                            text: input.text,
                            authorId: input.authorId,
                        };
                    }
                ),
            });

            const engine = syncEngine(schema, { from: 'new' });

            engine.mutate('createPost', {
                id: 'post-1',
                title: 'Hello World',
                content: 'This is a test post',
                authorId: 'author-1',
            });

            engine.mutate('addComment', {
                id: 'comment-1',
                postId: 'post-1',
                text: 'Great post!',
                authorId: 'author-2',
            });

            expect(engine.state.posts['post-1'].title).toBe('Hello World');
            expect(engine.state.comments['comment-1'].text).toBe('Great post!');
        });
    });
});
