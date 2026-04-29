/**
 * TC39 Signals - Minimal Implementation
 */
type Version = number;
interface ReactiveNode {
    version: Version;
    lastCleanEpoch: Version;
    dirty: boolean;
    producerNode: ReactiveNode[] | undefined;
    producerLastReadVersion: Version[] | undefined;
    producerIndexOfThis: number[] | undefined;
    nextProducerIndex: number;
    liveConsumerNode: ReactiveNode[] | undefined;
    liveConsumerIndexOfThis: number[] | undefined;
    consumerAllowSignalWrites: boolean;
    consumerIsAlwaysLive: boolean;
    producerMustRecompute(node: unknown): boolean;
    producerRecomputeValue(node: unknown): void;
    consumerMarkedDirty(): void;
    watched?(): void;
    unwatched?(): void;
    wrapper?: unknown;
    equal?(a: unknown, b: unknown): boolean;
    value?: unknown;
    computation?: () => unknown;
    error?: unknown;
}
export declare function isInNotificationPhase(): boolean;
declare const NODE: unique symbol;
export interface SignalOptions<T> {
    equals?: (a: T, b: T) => boolean;
}
export declare class State<T> {
    readonly [NODE]: ReactiveNode;
    constructor(initialValue: T, options?: SignalOptions<T>);
    get(): T;
    set(newValue: T): void;
}
export declare class Computed<T> {
    readonly [NODE]: ReactiveNode;
    constructor(computation: () => T, options?: SignalOptions<T>);
    get(): T;
}
export declare class Watcher {
    #private;
    readonly [NODE]: ReactiveNode;
    constructor(notify: () => void);
    watch(...signals: Array<State<unknown> | Computed<unknown>>): void;
    unwatch(...signals: Array<State<unknown> | Computed<unknown>>): void;
    getPending(): Array<Computed<unknown>>;
}
export declare function untrack<T>(fn: () => T): T;
export {};
