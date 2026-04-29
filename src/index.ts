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

type SignalStore = Record<string, State<unknown>>;
type ComputedStore = Record<string, Computed<unknown>>;

interface ComponentScope {
  signals: SignalStore;
  computeds: ComputedStore;
  el: Element;
  parent?: ComponentScope;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface ForItem {
  element: Element;
  scope: ComponentScope;
  cleanup: () => void;
}

interface ForState {
  anchor: Comment;
  keyMap: Map<unknown, ForItem>;
}

// Directive attribute names — individual consts for reliable esbuild inlining
const D_DATA = 'x-data';
const D_TEXT = 'x-text';
const D_HTML = 'x-html';
const D_SHOW = 'x-show';
const D_BIND = 'x-bind:';
const D_MODEL = 'x-model';
const D_ON = 'x-on:';
const D_FOR = 'x-for';
const D_IF = 'x-if';
const D_CLOAK = 'x-cloak';

// WeakMap to store initialized component scopes keyed by their root element.
// Avoids attaching arbitrary properties to DOM nodes and provides proper type safety.
const scopeMap = new WeakMap<Element, ComponentScope>();

interface ForExpression {
  itemName: string;
  indexName: string | null;
  arrayExpr: string;
}

function parseForExpression(expr: string): ForExpression | null {
  const m = expr.match(/^\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+))\s+(?:in|of)\s+(.+)\s*$/);
  if (!m) return null;
  return { itemName: m[3] || m[1], indexName: m[2] || null, arrayExpr: m[4].trim() };
}

// Normalize x-for source: arrays pass through, objects become entries, numbers become ranges
function toIterable(val: unknown): unknown[] | null {
  if (Array.isArray(val)) return val;
  if (typeof val === 'number') return Array.from({ length: val }, (_, i) => i + 1);
  if (val !== null && typeof val === 'object') return Object.entries(val as Record<string, unknown>);
  return null;
}

// Build with-statement code for expression evaluation.
// Walks parent chain so x-for items see ancestor scope keys.
// Only signals get setters — computeds are read-only.
function buildWithCode(scope: ComponentScope): string {
  const sigKeys: string[] = [];
  const allKeys: string[] = [];
  const seen = new Set<string>();
  let cur: ComponentScope | undefined = scope;
  while (cur) {
    for (const k of Object.keys(cur.signals)) {
      if (!seen.has(k)) { seen.add(k); allKeys.push(k); sigKeys.push(k); }
    }
    for (const k of Object.keys(cur.computeds)) {
      if (!seen.has(k)) { seen.add(k); allKeys.push(k); }
    }
    cur = cur.parent;
  }
  const g = allKeys.map(k => `get ${k}(){return s.get('${k}')}`).join(',');
  const t = sigKeys.map(k => `set ${k}(v){s.set('${k}',v)}`).join(',');
  return `with({${g}${t ? ',' + t : ''}})`;
}

// Build pre-compiled eval / exec functions for a fixed scope structure.
// Using pre-built fns avoids re-creating Function objects on every effect run.
// $el: current host element; $dispatch: CustomEvent helper; $nextTick: microtask promise.
type EvalFn = (s: ComponentScope, $el?: Element) => unknown;
type ExecFn = (s: ComponentScope, $event: Event | undefined, $el?: Element) => void;

// Magic variable preamble injected into every generated function body.
// Must be placed BEFORE the with() block so that with() doesn't shadow these names.
const MAGIC_PREAMBLE =
  `const $dispatch=(ev,d)=>$el&&$el.dispatchEvent(new CustomEvent(ev,{detail:d,bubbles:true,composed:true}));` +
  `const $nextTick=()=>Promise.resolve();`;

function mkEval(expr: string, wc: string): EvalFn {
  return new Function('s', '$el', `${MAGIC_PREAMBLE}${wc}{return(${expr})}`) as EvalFn;
}

function mkExec(stmt: string, wc: string): ExecFn {
  return new Function('s', '$event', '$el', `${MAGIC_PREAMBLE}${wc}{${stmt}}`) as ExecFn;
}

// Convert camelCase or CSS custom property names to kebab-case for style.setProperty.
const toKebab = (p: string): string =>
  p.startsWith('--') ? p : p.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

// Perform an immutable deep-set on a plain object/array, returning a new root.
// Supports both property names and numeric array indices in the path.
function deepSet(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const key = path[0];
  const rest = path.slice(1);
  if (Array.isArray(obj)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= obj.length) {
      console.warn(`x-model: array index ${key} is out of bounds (length ${obj.length})`);
      return obj;
    }
    const copy = [...obj];
    copy[idx] = deepSet(copy[idx], rest, value);
    return copy;
  }
  if (obj !== null && typeof obj === 'object') {
    return { ...(obj as Record<string, unknown>), [key]: deepSet((obj as Record<string, unknown>)[key], rest, value) };
  }
  return obj;
}

// After updating a root signal, propagate the change into any parent-scope array signal
// that contains the old item value (by reference). This ensures that x-for item property
// mutations are reflected in the source array and therefore in any x-text bound to it.
function propagateToParentArray(oldItem: unknown, newItem: unknown, parentScope: ComponentScope | undefined): void {
  let cur = parentScope;
  while (cur) {
    for (const sig of Object.values(cur.signals)) {
      const arr = sig.get();
      if (Array.isArray(arr)) {
        const idx = arr.findIndex((el: unknown) => el === oldItem);
        if (idx !== -1) {
          const newArr = [...arr];
          newArr[idx] = newItem;
          (sig as State<unknown>).set(newArr);
          return;
        }
      }
    }
    cur = cur.parent;
  }
}

// Parse a simple dotted/bracket path expression into segments.
// e.g. "item.name" → ["item","name"],  "arr[0].key" → ["arr","0","key"]
function parsePath(expr: string): string[] | null {
  const segments: string[] = [];
  const re = /([a-zA-Z_$][\w$]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(expr)) !== null) {
    if (match.index !== lastIndex && !(lastIndex === 0 && match.index === 0)) {
      // gap between matches — only dots are allowed as separators
      const gap = expr.slice(lastIndex, match.index).replace(/\./g, '');
      if (gap.length > 0) return null; // unexpected characters
    }
    segments.push(match[1] ?? match[2]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== expr.length) return null;
  return segments;
}

// Try to update a simple or dotted/bracketed path expression like "active", "item.name",
// or "obj.sub.prop" by finding the root signal and applying an update, returning true on success.
// Simple identifiers (e.g. "active") are resolved through the full scope chain via scope.set,
// which correctly handles parent-scope variables without JSON.stringify corruption (NaN→null etc.).
// Dotted/bracketed paths find the root signal and apply an immutable deep-set.
// Also propagates the update into any parent-scope array containing the old item
// so that x-for source arrays stay in sync.
// Falls back to false so the caller can use mkExec as a last resort.
const SIMPLE_PATH = /^[a-zA-Z_$][\w$]*(?:\.[\w$]+|\[\d+\])*$/;

function trySignalSet(expr: string, v: unknown, scope: ComponentScope): boolean {
  if (!SIMPLE_PATH.test(expr)) return false;
  const segments = parsePath(expr);
  if (!segments || segments.length === 0) return false;

  // Simple identifier — delegate through the scope chain (handles parent scopes and avoids
  // JSON.stringify which corrupts non-serialisable values like NaN).
  if (segments.length === 1) {
    scope.set(segments[0], v);
    return true;
  }

  const rootKey = segments[0];
  const path = segments.slice(1);

  let cur: ComponentScope | undefined = scope;
  while (cur) {
    if (rootKey in cur.signals) {
      const current = cur.signals[rootKey].get();
      const updated = deepSet(current, path, v);
      cur.signals[rootKey].set(updated);
      // Keep parent arrays in sync so x-text on items[i].prop also updates
      propagateToParentArray(current, updated, cur.parent);
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

// Extract the body of an arrow or regular function for use inside a with-statement.
function extractFnBody(fn: Function): string {
  const s = fn.toString();
  const arrowIdx = s.indexOf('=>');
  if (arrowIdx !== -1) {
    const body = s.slice(arrowIdx + 2).trim();
    // Block body — keep content as-is (caller handles return)
    if (body.startsWith('{') && body.endsWith('}')) return body.slice(1, -1).trim();
    // Expression body — wrap in return
    return `return(${body})`;
  }
  // Regular function — extract body between braces
  const m = s.match(/\{([\s\S]*)\}/);
  return m ? m[1].trim() : 'return undefined';
}

function createScopeFromString(el: Element, dataStr: string, parentScope?: ComponentScope): ComponentScope {
  const signals: SignalStore = {};
  const computeds: ComputedStore = {};

  const scope: ComponentScope = {
    signals,
    computeds,
    el,
    parent: parentScope,
    get(key) {
      if (key in signals) return signals[key].get();
      if (key in computeds) return computeds[key].get();
      if (parentScope) return parentScope.get(key);
      return undefined;
    },
    set(key, value) {
      if (key in signals) { signals[key].set(value); return; }
      if (parentScope) { parentScope.set(key, value); return; }
      signals[key] = new State(value);
    },
  };

  // Reactive proxy for init() lifecycle hook
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_, k: string) {
      if (k in signals) return signals[k].get();
      if (k in computeds) return computeds[k].get();
      return undefined;
    },
    set(_, k: string, v: unknown) {
      if (k in signals) signals[k].set(v);
      else signals[k] = new State(v);
      return true;
    },
  });

  const tempData = new Function(`return(${dataStr})`)() as Record<string, unknown>;
  let initFn: Function | null = null;

  // Pass 1: create signals for non-function properties
  for (const [k, v] of Object.entries(tempData)) {
    if (typeof v === 'function') {
      if (k === 'init') initFn = v as Function;
    } else {
      signals[k] = new State(v);
    }
  }

  // Pass 2: register placeholder computeds so all keys are visible in buildWithCode
  const fnBodies: [string, string][] = [];
  for (const [k, v] of Object.entries(tempData)) {
    if (typeof v === 'function' && k !== 'init') {
      fnBodies.push([k, extractFnBody(v as Function)]);
      computeds[k] = new Computed(() => undefined); // placeholder
    }
  }

  // Pass 3: rebuild with full scope (signals + all computeds) and replace placeholders
  if (fnBodies.length) {
    const wc = buildWithCode(scope);
    for (const [k, body] of fnBodies) {
      const fn = new Function('s', `${wc}{${body}}`) as EvalFn;
      computeds[k] = new Computed(() => {
        try { return fn(scope); }
        catch (e) { console.error(`Error in computed "${k}":`, e); return undefined; }
      });
    }
  }

  scopeMap.set(el, scope);

  if (initFn) initFn.call(proxy);

  return scope;
}

// Process all directives on an element; returns a cleanup function.
function processElement(el: Element, scope: ComponentScope): () => void {
  const cleanups: (() => void)[] = [];
  const wc = buildWithCode(scope); // pre-build once for all attrs on this element

  // x-cloak: remove after processing so CSS `[x-cloak]{display:none}` hides until ready
  if (el.hasAttribute(D_CLOAK)) el.removeAttribute(D_CLOAK);

  for (const { name, value } of Array.from(el.attributes)) {
    if (name === D_TEXT) {
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { el.textContent = String(fn(scope, el) ?? ''); }
        catch (e) { console.error(`x-text error: ${value}`, e); }
      }));

    } else if (name === D_HTML) {
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { el.innerHTML = String(fn(scope, el) ?? ''); }
        catch (e) { console.error(`x-html error: ${value}`, e); }
      }));

    } else if (name === D_SHOW) {
      const orig = (el as HTMLElement).style.display || '';
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { (el as HTMLElement).style.display = fn(scope, el) ? orig : 'none'; }
        catch (e) { console.error(`x-show error: ${value}`, e); }
      }));

    } else if (name === D_MODEL || name.startsWith(`${D_MODEL}.`)) {
      const input = el as HTMLInputElement;
      // Modifiers are encoded in the attribute name, e.g. x-model.lazy.trim="expr"
      const modStr = name.slice(D_MODEL.length); // '' | '.lazy' | '.lazy.trim' etc.
      const mods = new Set(modStr ? modStr.slice(1).split('.') : []);
      const isLazy = mods.has('lazy');
      const isTrim = mods.has('trim');
      const isNumber = mods.has('number');

      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try {
          const v = fn(scope, el);
          if (input.type === 'checkbox') input.checked = Boolean(v);
          else if (input.type === 'radio') input.checked = input.value === String(v);
          else input.value = String(v ?? '');
        } catch (e) { console.error(`x-model error: ${value}`, e); }
      }));
      const baseEvt = input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'radio'
        ? 'change' : 'input';
      const evt = isLazy ? 'change' : baseEvt;
      const handler = () => {
        let v: unknown;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'number' || input.type === 'range') v = input.valueAsNumber;
        else {
          const raw = input.value;
          if (isNumber) { const n = parseFloat(raw); v = isNaN(n) ? raw : n; }
          else if (isTrim) v = raw.trim();
          else v = raw;
        }
        if (!trySignalSet(value, v, scope)) {
          try { mkExec(`${value}=${JSON.stringify(v)}`, wc)(scope, undefined, el); }
          catch (e) { console.error(`x-model set error: ${value}`, e); }
        }
      };
      input.addEventListener(evt, handler);
      cleanups.push(() => input.removeEventListener(evt, handler));

    } else if (name.startsWith(D_BIND) || name.startsWith(':')) {
      const attr = name.startsWith(':') ? name.slice(1) : name.slice(D_BIND.length);
      const fn = mkEval(value, wc);

      if (attr === 'class') {
        // Track which classes are managed by this binding so we can remove stale ones.
        // Handles string (space-separated), array (truthy strings), and object ({cls: bool}) syntax.
        const managed = new Set<string>();
        cleanups.push(effect(() => {
          try {
            const v = fn(scope, el);
            const next = new Set<string>();
            if (Array.isArray(v)) {
              for (const c of v as unknown[]) {
                if (c && typeof c === 'string') {
                  for (const cls of (c as string).split(/\s+/).filter(Boolean)) next.add(cls);
                }
              }
            } else if (v !== null && typeof v === 'object') {
              for (const [cls, on] of Object.entries(v as Record<string, unknown>)) {
                if (Boolean(on)) next.add(cls);
              }
            } else if (typeof v === 'string') {
              for (const cls of v.split(/\s+/).filter(Boolean)) next.add(cls);
            }
            // Remove classes no longer active (diff to avoid unnecessary DOM thrash)
            for (const c of managed) if (!next.has(c)) el.classList.remove(c);
            // Add newly active classes
            for (const c of next) if (!managed.has(c)) el.classList.add(c);
            managed.clear();
            for (const c of next) managed.add(c);
          } catch (e) { console.error(`x-bind:class error: ${value}`, e); }
        }));

      } else if (attr === 'style') {
        cleanups.push(effect(() => {
          try {
            const v = fn(scope, el);
            if (Array.isArray(v)) {
              // Array of style objects — merge in order
              for (const obj of v as unknown[]) {
                if (obj !== null && typeof obj === 'object') {
                  for (const [p, pv] of Object.entries(obj as Record<string, unknown>)) {
                    (el as HTMLElement).style.setProperty(toKebab(p), String(pv ?? ''));
                  }
                }
              }
            } else if (v !== null && typeof v === 'object') {
              for (const [p, pv] of Object.entries(v as Record<string, unknown>)) {
                // Support both camelCase (backgroundColor) and CSS custom properties (--my-var)
                (el as HTMLElement).style.setProperty(toKebab(p), String(pv ?? ''));
              }
            } else {
              el.setAttribute('style', String(v ?? ''));
            }
          } catch (e) { console.error(`x-bind:style error: ${value}`, e); }
        }));

      } else {
        cleanups.push(effect(() => {
          try {
            const v = fn(scope, el);
            if (v === null || v === undefined || v === false) {
              el.removeAttribute(attr);
            } else if (v === true) {
              el.setAttribute(attr, '');
            } else {
              el.setAttribute(attr, String(v));
            }
          } catch (e) { console.error(`x-bind:${attr} error: ${value}`, e); }
        }));
      }

    } else if (name.startsWith(D_ON) || name.startsWith('@')) {
      const evtStr = name.startsWith('@') ? name.slice(1) : name.slice(D_ON.length);
      const parts = evtStr.split('.');
      const evtName = parts[0];
      const mods = new Set(parts.slice(1));
      const fn = mkExec(value, wc);
      const handler = (e: Event) => {
        if (mods.has('prevent')) e.preventDefault();
        if (mods.has('stop')) e.stopPropagation();
        if (mods.has('self') && e.target !== el) return;
        if (e instanceof KeyboardEvent) {
          if (mods.has('enter') && e.key !== 'Enter') return;
          if (mods.has('escape') && e.key !== 'Escape') return;
          if (mods.has('space') && e.key !== ' ') return;
          if (mods.has('tab') && e.key !== 'Tab') return;
        }
        try { fn(scope, e, el); }
        catch (err) { console.error(`@${evtStr} error: ${value}`, err); }
      };
      el.addEventListener(evtName, handler, { once: mods.has('once'), capture: mods.has('capture') });
      cleanups.push(() => el.removeEventListener(evtName, handler));
    }
  }

  return () => cleanups.forEach(fn => fn());
}

function createItemScope(
  parent: ComponentScope,
  el: Element,
  itemName: string,
  indexName: string | null,
  item: unknown,
  index: number,
): ComponentScope {
  const signals: SignalStore = { [itemName]: new State(item) };
  if (indexName) signals[indexName] = new State(index);
  return {
    signals,
    computeds: {},
    el,
    parent,
    get(key) { return key in signals ? signals[key].get() : parent.get(key); },
    set(key, value) {
      if (key in signals) signals[key].set(value);
      else parent.set(key, value);
    },
  };
}

// Walk and process all directive-bearing children within a content fragment,
// skipping nested x-data, x-for, and x-if roots (each handled separately).
// Returns a list of cleanup functions.
function processChildren(root: Element, scope: ComponentScope): (() => void)[] {
  const cleanups: (() => void)[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node) {
      const n = node as Element;
      if (n.hasAttribute(D_DATA)) return NodeFilter.FILTER_REJECT;
      if (n.tagName === 'TEMPLATE' && (n.hasAttribute(D_FOR) || n.hasAttribute(D_IF))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    cleanups.push(processElement(node, scope));
  }
  // Process x-for and x-if templates within this root (not inside nested x-data)
  root.querySelectorAll(`template[${D_FOR}], template[${D_IF}]`).forEach(t => {
    // Skip if inside a nested x-data or a nested x-for/x-if that hasn't been removed yet
    let p = t.parentElement;
    while (p && p !== root) {
      if (p.hasAttribute(D_DATA)) return;
      p = p.parentElement;
    }
    if ((t as HTMLTemplateElement).hasAttribute(D_FOR)) {
      cleanups.push(processForDirective(t as HTMLTemplateElement, scope));
    } else if ((t as HTMLTemplateElement).hasAttribute(D_IF)) {
      cleanups.push(processIfDirective(t as HTMLTemplateElement, scope));
    }
  });
  return cleanups;
}

// x-if directive: conditionally insert/remove a template's content based on an expression.
// Must be placed on a <template> element.
function processIfDirective(template: HTMLTemplateElement, scope: ComponentScope): () => void {
  const ifExpr = template.getAttribute(D_IF);
  if (!ifExpr) return () => {};

  const anchor = document.createComment('x-if');
  template.parentNode?.insertBefore(anchor, template);
  template.remove();

  const evalCond = mkEval(ifExpr, buildWithCode(scope));
  let currentElement: Element | null = null;
  let currentCleanup: (() => void) | null = null;

  const cleanup = effect(() => {
    try {
      const shown = Boolean(evalCond(scope, anchor as unknown as Element));
      untrack(() => {
        if (shown && !currentElement) {
          // Insert template content
          const content = template.content.cloneNode(true) as DocumentFragment;
          const element = content.firstElementChild;
          if (!element) return;
          const childCleanups = [processElement(element, scope), ...processChildren(element, scope)];
          anchor.parentNode?.insertBefore(element, anchor.nextSibling);
          currentElement = element;
          currentCleanup = () => childCleanups.forEach(f => f());
        } else if (!shown && currentElement) {
          // Remove template content
          currentElement.remove();
          currentCleanup?.();
          currentElement = null;
          currentCleanup = null;
        }
      });
    } catch (e) {
      console.error(`x-if error: ${ifExpr}`, e);
    }
  });

  return () => {
    cleanup();
    currentElement?.remove();
    currentCleanup?.();
    anchor.remove();
  };
}

function processForDirective(template: HTMLTemplateElement, parentScope: ComponentScope): () => void {
  const forExpr = template.getAttribute(D_FOR);
  if (!forExpr) return () => {};

  const parsed = parseForExpression(forExpr);
  if (!parsed) { console.error(`Invalid x-for expression: ${forExpr}`); return () => {}; }

  const { itemName, indexName, arrayExpr } = parsed;
  const keyExpr = template.getAttribute(':key') || template.getAttribute('x-bind:key');

  const anchor = document.createComment('x-for');
  template.parentNode?.insertBefore(anchor, template);
  template.remove();

  const state: ForState = { anchor, keyMap: new Map() };

  // Pre-build array expression evaluator against parent scope
  const evalItems = mkEval(arrayExpr, buildWithCode(parentScope));

  const getKey = (itemScope: ComponentScope, index: number): unknown => {
    if (!keyExpr) return index;
    return (mkEval(keyExpr, buildWithCode(itemScope)))(itemScope, itemScope.el as Element);
  };

  const createForItem = (item: unknown, index: number): ForItem => {
    const content = template.content.cloneNode(true) as DocumentFragment;
    const element = content.firstElementChild;
    if (!element) throw new Error('x-for template must have a single root element');

    const itemScope = createItemScope(parentScope, element, itemName, indexName, item, index);
    const cleanups = [processElement(element, itemScope), ...processChildren(element, itemScope)];

    return {
      element,
      scope: itemScope,
      cleanup: () => cleanups.forEach(fn => fn()),
    };
  };

  const updateForItem = (fi: ForItem, item: unknown, index: number): void => {
    fi.scope.signals[itemName].set(item);
    if (indexName) fi.scope.signals[indexName]?.set(index);
  };

  const reconcile = (newItems: unknown[]): void => {
    const { keyMap } = state;
    const len = newItems.length;

    // Compute new keys
    const newKeys = newItems.map((it, i) =>
      getKey(createItemScope(parentScope, anchor as unknown as Element, itemName, indexName, it, i), i)
    );
    const newKeySet = new Set(newKeys);

    // Remove items no longer present
    for (const [key, fi] of keyMap) {
      if (!newKeySet.has(key)) { fi.element.remove(); fi.cleanup(); keyMap.delete(key); }
    }

    if (!len) return;

    // Place/create items in correct DOM order (minimal moves: only when out of position)
    let prev: ChildNode | null = anchor;
    for (let i = 0; i < len; i++) {
      const key = newKeys[i];
      let fi = keyMap.get(key);

      if (!fi) {
        fi = createForItem(newItems[i], i);
        keyMap.set(key, fi);
      } else {
        updateForItem(fi, newItems[i], i);
      }

      // Move only if not already in the correct position
      const expected: ChildNode | null = prev ? prev.nextSibling : anchor.nextSibling;
      if (fi.element !== expected) {
        anchor.parentNode?.insertBefore(fi.element, expected);
      }
      prev = fi.element;
    }
  };

  const cleanup = effect(() => {
    try {
      const items = toIterable(evalItems(parentScope, anchor as unknown as Element));
      if (!items) { console.error(`x-for: "${arrayExpr}" must be array, object, or number`); return; }
      // Reconcile in an untracked context so that effects created for each item (x-model,
      // x-text, etc.) are NOT registered as dependencies of this outer x-for computed.
      // Without untrack, any signal those inner effects depend on would also trigger a full
      // x-for re-reconcile, even when only a single item's binding needs to update.
      untrack(() => reconcile(items));
    } catch (e) {
      console.error(`x-for error: ${arrayExpr}`, e);
    }
  });

  return () => {
    cleanup();
    for (const fi of state.keyMap.values()) { fi.element.remove(); fi.cleanup(); }
    state.keyMap.clear();
    anchor.remove();
  };
}

function initializeComponent(root: Element): void {
  // getAttribute returns null when no attribute, '' when attribute has no value (e.g. <div x-data>)
  const rawData = root.getAttribute(D_DATA);
  if (rawData === null) return;
  // Treat empty x-data (bare attribute or empty string) as an empty object
  const dataAttr = rawData.trim() || '{}';

  // Skip already-initialized components to prevent double-processing.
  // Re-initialization only makes sense when the element is a fresh DOM node
  // (e.g. added by server-side rendering or a framework like Livewire).
  if (scopeMap.has(root)) return;

  // Find the nearest ancestor component scope so nested x-data can read/write parent state
  let parentScope: ComponentScope | undefined;
  let ancestor = root.parentElement;
  while (ancestor) {
    const s = scopeMap.get(ancestor);
    if (s !== undefined) { parentScope = s; break; }
    ancestor = ancestor.parentElement;
  }

  let scope: ComponentScope;
  try {
    scope = createScopeFromString(root, dataAttr, parentScope);
  } catch (e) {
    console.error(`Error parsing x-data: ${dataAttr}`, e);
    return;
  }

  processElement(root, scope);
  processChildren(root, scope);
}

function init(root: Element | Document = document): void {
  root.querySelectorAll(`[${D_DATA}]`).forEach(el => initializeComponent(el));
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    queueMicrotask(() => init());
  }
}

export const K2 = { init, State, Computed, effect, untrack, version: '1.1.0' };
export default K2;

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).K2 = K2;
}
