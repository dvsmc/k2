/**
 * Effect System - Reactive side effects built on TC39 Signals
 */
export type CleanupFn = () => void;
export type EffectFn = () => CleanupFn | void;
export declare function effect(callback: EffectFn): () => void;
export declare function batch(fn: () => void): void;
