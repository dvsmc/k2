/**
 * K2 - An Alpine.js-like framework powered by TC39 Signals
 *
 * Usage:
 * <div x-data="{ count: 0 }">
 *   <span x-text="count"></span>
 *   <button @click="count++">+</button>
 * </div>
 */
import { State, Computed, untrack } from './signals';
import { effect } from './effect';
export { State, Computed, untrack } from './signals';
export { effect } from './effect';
declare function init(root?: Element | Document): void;
export declare const K2: {
    init: typeof init;
    State: typeof State;
    Computed: typeof Computed;
    effect: typeof effect;
    untrack: typeof untrack;
    version: string;
};
export default K2;
