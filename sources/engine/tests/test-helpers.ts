/**
 * Shared test utilities
 */

import type { DiffResult } from '../types';

/**
 * Check if an operation was accepted
 */
export function isAccepted(results: DiffResult, opId: string): boolean {
    return results.get(opId)?.accepted === true;
}

/**
 * Get rejection reason for an operation
 */
export function getReason(results: DiffResult, opId: string): string | undefined {
    return results.get(opId)?.reason;
}
