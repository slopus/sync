/**
 * Client-side collection with operation rebasing
 *
 * ClientCollection maintains server state and rebases pending local operations
 * on top of it. When server state updates, all pending operations are
 * automatically rebased on the new state.
 */

import type {
    ItemId,
    Item,
    DiffOperation,
    Diff,
    DiffResult,
    OperationId,
} from './types';
import { Collection } from './collection';

/**
 * A pending operation with tracking metadata
 */
export type PendingOperation<TShape> = {
    operation: DiffOperation<TShape>;
    createdAt: number;
    lastRebaseAt: number;
    orderTime: number; // Monotonic counter for stable ordering
};

/**
 * Configuration for ClientCollection
 */
export type ClientCollectionConfig = {
    /**
     * Maximum age of pending operations in milliseconds
     * Operations older than this are automatically removed
     * Default: 5 minutes
     */
    maxPendingAge?: number;
};

/**
 * Client-side collection that rebases pending operations on server state
 *
 * Architecture:
 * 1. Server state is the source of truth (base collection)
 * 2. Pending operations are local changes awaiting server confirmation
 * 3. Current view = server state + rebased pending operations
 * 4. When server state updates, pending operations are rebased on top
 * 5. Old or failing operations are automatically removed
 */
export class ClientCollection<TShape> {
    private serverState: Collection<TShape>;
    private currentView: Collection<TShape>;
    private pendingOps: Map<OperationId, PendingOperation<TShape>>;
    private config: Required<ClientCollectionConfig>;
    private maxOperationTime: number;

    constructor(name: string, config: ClientCollectionConfig = {}) {
        this.serverState = new Collection<TShape>(`${name}:server`);
        this.currentView = new Collection<TShape>(`${name}:view`);
        this.pendingOps = new Map();
        this.maxOperationTime = 0;
        this.config = {
            maxPendingAge: config.maxPendingAge ?? 5 * 60 * 1000, // 5 minutes
        };
    }

    /**
     * Get the collection name
     */
    get name(): string {
        return this.serverState.name.replace(':server', '');
    }

    /**
     * Read all items from current view (server state + pending operations)
     */
    read(): Item<TShape>[] {
        return this.currentView.read();
    }

    /**
     * Read a specific item by ID from current view
     */
    readOne(id: ItemId): Item<TShape> | undefined {
        return this.currentView.readOne(id);
    }

    /**
     * Read server state (without pending operations)
     */
    readServerState(): Item<TShape>[] {
        return this.serverState.read();
    }

    /**
     * Apply server operations and rebase pending operations on top
     *
     * This is the main synchronization method:
     * 1. Apply server operations to server state
     * 2. Clean up old/failed pending operations
     * 3. Rebase all pending operations on new server state
     *
     * @param diff - Operations from the server
     * @returns Results of applying server operations
     */
    applyServerUpdate(diff: Diff<TShape>): DiffResult {
        // Step 1: Apply server operations to server state
        const serverResults = this.serverState.applyDiff(diff);

        // Step 2: Remove pending operations that match server operations
        for (const operation of diff) {
            this.pendingOps.delete(operation.opId);
        }

        // Step 3: Clean up old and failing pending operations
        this.cleanupPendingOperations();

        // Step 4: Rebase pending operations on new server state
        this.rebasePendingOperations();

        return serverResults;
    }

    /**
     * Apply a local operation (user-initiated change)
     *
     * The operation is:
     * 1. Added to pending operations list
     * 2. Applied to current view immediately (optimistic update)
     *
     * @param diff - Local operations to apply
     * @returns Results of applying to current view
     */
    applyLocal(diff: Diff<TShape>): DiffResult {
        const now = Date.now();
        const results = this.currentView.applyDiff(diff);

        // Track accepted operations as pending
        for (const operation of diff) {
            const result = results.get(operation.opId);
            if (result?.accepted) {
                const orderTime = this.getNextOrderTime();
                this.pendingOps.set(operation.opId, {
                    operation,
                    createdAt: now,
                    lastRebaseAt: now,
                    orderTime,
                });
            }
        }

        return results;
    }

    /**
     * Remove operations by their IDs
     * Used for both server-confirmed and server-rejected operations
     *
     * @param opIds - Operation IDs to remove
     * @returns Number of operations removed
     */
    removeOperations(opIds: OperationId[]): number {
        let count = 0;
        for (const opId of opIds) {
            if (this.pendingOps.delete(opId)) {
                count++;
            }
        }

        // Rebase remaining operations
        if (count > 0) {
            this.rebasePendingOperations();
        }

        return count;
    }

    /**
     * Get all pending operations (to send to server)
     *
     * @returns Array of pending operations sorted by order time
     */
    getPendingOperations(): Diff<TShape> {
        return Array.from(this.pendingOps.values())
            .sort((a, b) => a.orderTime - b.orderTime)
            .map((pending) => pending.operation);
    }

    /**
     * Get pending operations metadata
     */
    getPendingMetadata(): PendingOperation<TShape>[] {
        return Array.from(this.pendingOps.values()).sort(
            (a, b) => a.orderTime - b.orderTime
        );
    }

    /**
     * Get count of pending operations
     */
    getPendingCount(): number {
        return this.pendingOps.size;
    }

    /**
     * Manually trigger a rebase of pending operations
     * (useful for testing or debugging)
     */
    rebase(): void {
        this.rebasePendingOperations();
    }

    /**
     * Clear all pending operations
     */
    clearPendingOperations(): void {
        this.pendingOps.clear();
        this.rebasePendingOperations();
    }

    /**
     * Rebase all pending operations on top of server state
     *
     * Process:
     * 1. Reset current view to match server state
     * 2. Apply all pending operations in order
     * 3. Remove operations that fail to apply
     */
    private rebasePendingOperations(): void {
        // Step 1: Clone server state to current view
        this.currentView = new Collection<TShape>(`${this.name}:view`);
        const serverItems = this.serverState.read();
        if (serverItems.length > 0) {
            const cloneDiff: Diff<TShape> = serverItems.map((item) => ({
                opId: `clone:${item.id}`,
                type: 'create',
                item,
            }));
            this.currentView.applyDiff(cloneDiff);
        }

        // Step 2: Apply pending operations in order
        const now = Date.now();
        const pendingOps = Array.from(this.pendingOps.entries()).sort(
            ([, a], [, b]) => a.orderTime - b.orderTime
        );

        for (const [opId, pending] of pendingOps) {
            const results = this.currentView.applyDiff([pending.operation]);
            const result = results.get(pending.operation.opId);

            // Update metadata
            pending.lastRebaseAt = now;

            // Remove operation immediately if it fails to rebase
            if (!result?.accepted) {
                this.pendingOps.delete(opId);
            }
        }
    }

    /**
     * Remove pending operations that are too old
     */
    private cleanupPendingOperations(): void {
        const now = Date.now();
        const toRemove: OperationId[] = [];

        for (const [opId, pending] of this.pendingOps.entries()) {
            const age = now - pending.createdAt;

            // Remove if too old
            if (age > this.config.maxPendingAge) {
                toRemove.push(opId);
            }
        }

        for (const opId of toRemove) {
            this.pendingOps.delete(opId);
        }
    }

    /**
     * Get the next monotonic order time
     * Ensures operations are always ordered correctly even if system clock changes
     */
    private getNextOrderTime(): number {
        const now = Date.now();

        // If no pending operations, use current time
        if (this.pendingOps.size === 0) {
            this.maxOperationTime = now;
            return now;
        }

        // If current time is greater than max, use it
        if (now > this.maxOperationTime) {
            this.maxOperationTime = now;
            return now;
        }

        // Otherwise, use max + 1 to maintain monotonicity
        this.maxOperationTime = this.maxOperationTime + 1;
        return this.maxOperationTime;
    }
}
