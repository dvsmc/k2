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
  key: unknown;
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

// WeakMap to store initialized component scopes keyed by their root element.
// Avoids attaching arbitrary properties to DOM nodes and provides proper type safety.
const scopeMap = new WeakMap<Element, ComponentScope>();

interface ForExpression {
  itemName: string;
  indexName: string | null;
  arrayExpr: string;
}

function parseForExpression(expr: string): ForExpression | null {
  const m = expr.match(/^\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+))\s+in\s+(.+)\s*$/);
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
type EvalFn = (s: ComponentScope) => unknown;
type ExecFn = (s: ComponentScope, e?: Event) => void;

function mkEval(expr: string, wc: string): EvalFn {
  return new Function('s', `${wc}{return(${expr})}`) as EvalFn;
}

function mkExec(stmt: string, wc: string): ExecFn {
  return new Function('s', '$event', `${wc}{${stmt}}`) as ExecFn;
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

  for (const { name, value } of Array.from(el.attributes)) {
    if (name === D_TEXT) {
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { el.textContent = String(fn(scope) ?? ''); }
        catch (e) { console.error(`x-text error: ${value}`, e); }
      }));

    } else if (name === D_HTML) {
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { el.innerHTML = String(fn(scope) ?? ''); }
        catch (e) { console.error(`x-html error: ${value}`, e); }
      }));

    } else if (name === D_SHOW) {
      const orig = (el as HTMLElement).style.display || '';
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try { (el as HTMLElement).style.display = fn(scope) ? orig : 'none'; }
        catch (e) { console.error(`x-show error: ${value}`, e); }
      }));

    } else if (name === D_MODEL) {
      const input = el as HTMLInputElement;
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try {
          const v = fn(scope);
          if (input.type === 'checkbox') input.checked = Boolean(v);
          else if (input.type === 'radio') input.checked = input.value === String(v);
          else input.value = String(v ?? '');
        } catch (e) { console.error(`x-model error: ${value}`, e); }
      }));
      const evt = input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'radio'
        ? 'change' : 'input';
      const handler = () => {
        let v: unknown;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'number' || input.type === 'range') v = input.valueAsNumber;
        else v = input.value;
        if (value in scope.signals) scope.set(value, v);
        else {
          try { mkExec(`${value}=${JSON.stringify(v)}`, wc)(scope); }
          catch (e) { console.error(`x-model set error: ${value}`, e); }
        }
      };
      input.addEventListener(evt, handler);
      cleanups.push(() => input.removeEventListener(evt, handler));

    } else if (name.startsWith(D_BIND) || name.startsWith(':')) {
      const attr = name.startsWith(':') ? name.slice(1) : name.slice(D_BIND.length);
      const fn = mkEval(value, wc);
      cleanups.push(effect(() => {
        try {
          const v = fn(scope);
          if (attr === 'class') {
            if (v !== null && typeof v === 'object') {
              for (const [cls, on] of Object.entries(v)) el.classList.toggle(cls, Boolean(on));
            } else el.setAttribute('class', String(v ?? ''));
          } else if (attr === 'style') {
            if (v !== null && typeof v === 'object') {
              for (const [p, pv] of Object.entries(v)) (el as HTMLElement).style.setProperty(p, String(pv ?? ''));
            } else el.setAttribute('style', String(v ?? ''));
          } else if (v === null || v === undefined || v === false) {
            el.removeAttribute(attr);
          } else if (v === true) {
            el.setAttribute(attr, '');
          } else {
            el.setAttribute(attr, String(v));
          }
        } catch (e) { console.error(`x-bind:${attr} error: ${value}`, e); }
      }));

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
        try { fn(scope, e); }
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
    return (mkEval(keyExpr, buildWithCode(itemScope)))(itemScope);
  };

  const createForItem = (item: unknown, index: number): ForItem => {
    const content = template.content.cloneNode(true) as DocumentFragment;
    const element = content.firstElementChild;
    if (!element) throw new Error('x-for template must have a single root element');

    const itemScope = createItemScope(parentScope, element, itemName, indexName, item, index);
    const cleanups: (() => void)[] = [processElement(element, itemScope)];

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let node: Element | null;
    while ((node = walker.nextNode() as Element | null)) {
      cleanups.push(node.tagName === 'TEMPLATE' && node.hasAttribute(D_FOR)
        ? processForDirective(node as HTMLTemplateElement, itemScope)
        : processElement(node, itemScope));
    }

    return {
      key: getKey(itemScope, index),
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
      const expected = prev ? prev.nextSibling : anchor.nextSibling;
      if (fi.element !== expected) {
        anchor.parentNode?.insertBefore(fi.element, expected);
      }
      prev = fi.element;
    }
  };

  const cleanup = effect(() => {
    try {
      const items = toIterable(evalItems(parentScope));
      if (!items) { console.error(`x-for: "${arrayExpr}" must be array, object, or number`); return; }
      reconcile(items);
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
  const dataAttr = root.getAttribute(D_DATA);
  if (!dataAttr) return;

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

  // Collect x-for templates before walking (they remove themselves from DOM during processing)
  const forTemplates: HTMLTemplateElement[] = [];
  root.querySelectorAll(`template[${D_FOR}]`).forEach(el => {
    let parent = el.parentElement;
    while (parent && parent !== root) {
      if (parent.hasAttribute(D_DATA)) return;
      parent = parent.parentElement;
    }
    forTemplates.push(el as HTMLTemplateElement);
  });

  // Walk child elements.
  // Use FILTER_REJECT on nested x-data roots and x-for templates so the entire
  // subtree is skipped — not just the root node. This prevents the outer walker
  // from processing children that belong to a nested scope, and avoids
  // double-processing elements inserted by x-for on re-initialization.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node) {
      const el = node as Element;
      if (el.hasAttribute(D_DATA)) return NodeFilter.FILTER_REJECT;
      if (el.tagName === 'TEMPLATE' && el.hasAttribute(D_FOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    processElement(node, scope);
  }

  for (const t of forTemplates) processForDirective(t, scope);
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
