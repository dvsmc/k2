import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { K2 } from '../src/index';

describe('K2 Directives', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('x-data', () => {
    it('should initialize component with data', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('0');
    });

    it('should support nested values', async () => {
      container.innerHTML = `
        <div x-data="{ user: { name: 'John' } }">
          <span x-text="user.name"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('John');
    });
  });

  describe('x-text', () => {
    it('should set text content', async () => {
      container.innerHTML = `
        <div x-data="{ message: 'Hello' }">
          <span x-text="message"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('Hello');
    });

    it('should update when data changes', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <span x-text="count"></span>
          <button @click="count++">+</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      const button = container.querySelector('button');

      expect(span?.textContent).toBe('0');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('1');
    });

    it('should support expressions', async () => {
      container.innerHTML = `
        <div x-data="{ a: 2, b: 3 }">
          <span x-text="a + b"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('5');
    });
  });

  describe('x-html', () => {
    it('should set inner HTML', async () => {
      container.innerHTML = `
        <div x-data="{ html: '<strong>Bold</strong>' }">
          <div x-html="html"></div>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const div = container.querySelector('[x-html]');
      expect(div?.innerHTML).toBe('<strong>Bold</strong>');
    });
  });

  describe('x-show', () => {
    it('should toggle visibility', async () => {
      container.innerHTML = `
        <div x-data="{ visible: true }">
          <span x-show="visible">Visible</span>
          <button @click="visible = false">Hide</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span') as HTMLElement;
      const button = container.querySelector('button');

      expect(span?.style.display).not.toBe('none');

      button?.click();
      await Promise.resolve();

      expect(span?.style.display).toBe('none');
    });
  });

  describe('x-bind', () => {
    it('should bind attributes', async () => {
      container.innerHTML = `
        <div x-data="{ url: 'https://example.com' }">
          <a x-bind:href="url">Link</a>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://example.com');
    });

    it('should support :attr shorthand', async () => {
      container.innerHTML = `
        <div x-data="{ title: 'Hello' }">
          <span :title="title">Text</span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.getAttribute('title')).toBe('Hello');
    });

    it('should handle class object syntax', async () => {
      container.innerHTML = `
        <div x-data="{ active: true, disabled: false }">
          <span :class="{ active: active, disabled: disabled }">Text</span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.classList.contains('active')).toBe(true);
      expect(span?.classList.contains('disabled')).toBe(false);
    });

    it('should remove attribute when value is false/null/undefined', async () => {
      container.innerHTML = `
        <div x-data="{ isDisabled: false }">
          <button :disabled="isDisabled">Click</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      expect(button?.hasAttribute('disabled')).toBe(false);
    });

    it('should add empty attribute when value is true', async () => {
      container.innerHTML = `
        <div x-data="{ isDisabled: true }">
          <button :disabled="isDisabled">Click</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      expect(button?.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('x-model', () => {
    it('should two-way bind input value', async () => {
      container.innerHTML = `
        <div x-data="{ name: 'John' }">
          <input x-model="name" type="text">
          <span x-text="name"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const input = container.querySelector('input') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('John');
      expect(span?.textContent).toBe('John');

      // Simulate user input
      input.value = 'Jane';
      input.dispatchEvent(new Event('input'));
      await Promise.resolve();

      expect(span?.textContent).toBe('Jane');
    });

    it('should work with checkbox', async () => {
      container.innerHTML = `
        <div x-data="{ checked: false }">
          <input x-model="checked" type="checkbox">
          <span x-text="checked"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const input = container.querySelector('input') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.checked).toBe(false);
      expect(span?.textContent).toBe('false');

      // Simulate checkbox toggle
      input.checked = true;
      input.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(span?.textContent).toBe('true');
    });

    it('should work with number input', async () => {
      container.innerHTML = `
        <div x-data="{ count: 5 }">
          <input x-model="count" type="number">
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const input = container.querySelector('input') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('5');

      // Simulate user input
      input.value = '10';
      input.dispatchEvent(new Event('input'));
      await Promise.resolve();

      expect(span?.textContent).toBe('10');
    });

    it('should work with radio buttons', async () => {
      container.innerHTML = `
        <div x-data="{ color: 'red' }">
          <input type="radio" name="color" value="red" x-model="color" id="r1">
          <input type="radio" name="color" value="blue" x-model="color" id="r2">
          <span x-text="color"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const r1 = container.querySelector('#r1') as HTMLInputElement;
      const r2 = container.querySelector('#r2') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(r1.checked).toBe(true);
      expect(r2.checked).toBe(false);
      expect(span?.textContent).toBe('red');

      r2.checked = true;
      r2.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(span?.textContent).toBe('blue');
      expect(r1.checked).toBe(false);
      expect(r2.checked).toBe(true);
    });

    it('should work with select element', async () => {
      container.innerHTML = `
        <div x-data="{ plan: 'basic' }">
          <select x-model="plan">
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
          <span x-text="plan"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const select = container.querySelector('select') as HTMLSelectElement;
      const span = container.querySelector('span');

      expect(select.value).toBe('basic');
      expect(span?.textContent).toBe('basic');

      select.value = 'pro';
      select.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(span?.textContent).toBe('pro');
    });
  });

  describe('x-on / @', () => {
    it('should handle click events', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <button @click="count++">+</button>
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      const span = container.querySelector('span');

      expect(span?.textContent).toBe('0');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('1');
    });

    it('should support x-on:event syntax', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <button x-on:click="count++">+</button>
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      const span = container.querySelector('span');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('1');
    });

    it('should provide $event', async () => {
      container.innerHTML = `
        <div x-data="{ type: '' }">
          <button @click="type = $event.type">Click</button>
          <span x-text="type"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      const span = container.querySelector('span');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('click');
    });

    it('should support .prevent modifier', async () => {
      let defaultPrevented = false;

      container.innerHTML = `
        <div x-data="{}">
          <form @submit.prevent=""></form>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const form = container.querySelector('form');
      form?.addEventListener('submit', (e) => {
        defaultPrevented = e.defaultPrevented;
      });

      form?.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(defaultPrevented).toBe(true);
    });

    it('should support .stop modifier', async () => {
      let parentClicked = false;

      container.innerHTML = `
        <div x-data="{}">
          <div @click="() => {}">
            <button @click.stop="">Click</button>
          </div>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const parent = container.querySelector('div > div');
      const button = container.querySelector('button');

      parent?.addEventListener('click', () => {
        parentClicked = true;
      });

      button?.click();
      expect(parentClicked).toBe(false);
    });
  });

  describe('Computed properties', () => {
    it('should support computed via arrow functions', async () => {
      container.innerHTML = `
        <div x-data="{ a: 2, b: 3, product: () => a * b }">
          <span x-text="product"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('6');
    });

    it('should update computed when dependencies change', async () => {
      container.innerHTML = `
        <div x-data="{ count: 1, doubled: () => count * 2 }">
          <span x-text="doubled"></span>
          <button @click="count++">+</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      const button = container.querySelector('button');

      expect(span?.textContent).toBe('2');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('4');
    });

    it('should support computed referencing another computed', async () => {
      container.innerHTML = `
        <div x-data="{ a: 2, doubled: () => a * 2, quadrupled: () => doubled * 2 }">
          <span x-text="quadrupled"></span>
          <button @click="a++">+</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span');
      const button = container.querySelector('button');

      expect(span?.textContent).toBe('8');

      button?.click();
      await Promise.resolve();

      expect(span?.textContent).toBe('12');
    });
  });

  describe('x-for', () => {
    it('should render initial list', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}, {id: 3, name: 'C'}] }">
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('A');
      expect(items[1].textContent).toBe('B');
      expect(items[2].textContent).toBe('C');
    });

    it('should add new items', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}] }">
          <button @click="items = [...items, {id: 2, name: 'B'}]">Add</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      let items = container.querySelectorAll('.item');
      expect(items.length).toBe(1);

      const button = container.querySelector('button');
      button?.click();
      await Promise.resolve();

      items = container.querySelectorAll('.item');
      expect(items.length).toBe(2);
      expect(items[1].textContent).toBe('B');
    });

    it('should remove items', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}, {id: 3, name: 'C'}] }">
          <button @click="items = items.filter(i => i.id !== 2)">Remove B</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      let items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);

      const button = container.querySelector('button');
      button?.click();
      await Promise.resolve();

      items = container.querySelectorAll('.item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe('A');
      expect(items[1].textContent).toBe('C');
    });

    it('should reorder items with minimal DOM operations', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}, {id: 3, name: 'C'}] }">
          <button @click="items = [items[2], items[1], items[0]]">Reverse</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      // Get initial elements
      let items = container.querySelectorAll('.item');
      const firstElement = items[0];
      const lastElement = items[2];

      const button = container.querySelector('button');
      button?.click();
      await Promise.resolve();

      // Elements should be reordered, not recreated
      items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('C');
      expect(items[1].textContent).toBe('B');
      expect(items[2].textContent).toBe('A');

      // Verify DOM elements were moved, not recreated (same instances)
      expect(items[0]).toBe(lastElement);
      expect(items[2]).toBe(firstElement);
    });

    it('should support index in loop', async () => {
      container.innerHTML = `
        <div x-data="{ items: ['A', 'B', 'C'] }">
          <template x-for="(item, index) in items" :key="index">
            <div class="item" x-text="index + ': ' + item"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('0: A');
      expect(items[1].textContent).toBe('1: B');
      expect(items[2].textContent).toBe('2: C');
    });

    it('should work without :key (fallback to index)', async () => {
      container.innerHTML = `
        <div x-data="{ items: ['A', 'B', 'C'] }">
          <template x-for="item in items">
            <div class="item" x-text="item"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('A');
      expect(items[1].textContent).toBe('B');
      expect(items[2].textContent).toBe('C');
    });

    it('should update item data reactively', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, value: 'A'}] }">
          <button @click="items = [{id: 1, value: 'B'}]">Update</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.value"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await new Promise(r => setTimeout(r, 0));

      let items = container.querySelectorAll('.item');
      expect(items[0].textContent).toBe('A');

      const button = container.querySelector('button');
      button?.click();
      await new Promise(r => setTimeout(r, 0));

      items = container.querySelectorAll('.item');
      expect(items[0].textContent).toBe('B');
    });

    it('should support x-bind inside x-for', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, active: true}, {id: 2, active: false}] }">
          <template x-for="item in items" :key="item.id">
            <div class="item" :class="{ active: item.active }"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const items = container.querySelectorAll('.item');
      expect(items[0].classList.contains('active')).toBe(true);
      expect(items[1].classList.contains('active')).toBe(false);
    });

    it('should clear all items', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}] }">
          <button @click="items = []">Clear</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      let items = container.querySelectorAll('.item');
      expect(items.length).toBe(2);

      const button = container.querySelector('button');
      button?.click();
      await Promise.resolve();

      items = container.querySelectorAll('.item');
      expect(items.length).toBe(0);
    });

    it('should iterate over an object (entries)', async () => {
      container.innerHTML = `
        <div x-data="{ user: { name: 'Alice', age: 30 } }">
          <template x-for="(entry, index) in user" :key="index">
            <div class="entry" x-text="entry[0] + ':' + entry[1]"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const entries = container.querySelectorAll('.entry');
      expect(entries.length).toBe(2);
      expect(entries[0].textContent).toBe('name:Alice');
      expect(entries[1].textContent).toBe('age:30');
    });

    it('should iterate over a number (range)', async () => {
      container.innerHTML = `
        <div x-data="{ count: 3 }">
          <template x-for="i in count" :key="i">
            <div class="num" x-text="i"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const nums = container.querySelectorAll('.num');
      expect(nums.length).toBe(3);
      expect(nums[0].textContent).toBe('1');
      expect(nums[1].textContent).toBe('2');
      expect(nums[2].textContent).toBe('3');
    });

    it('should support x-model inside x-for with reactive write-back', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{ id: 1, name: 'A' }] }">
          <template x-for="item in items" :key="item.id">
            <input class="inp" x-model="item.name" type="text">
          </template>
          <span x-text="items[0].name"></span>
        </div>
      `;

      K2.init(container);
      await new Promise(r => setTimeout(r, 0));

      const input = container.querySelector('.inp') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('A');
      expect(span?.textContent).toBe('A');

      // Simulate user typing — should trigger reactive update
      input.value = 'Z';
      input.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 0));

      expect(span?.textContent).toBe('Z');
    });

    it('should support nested x-for (x-for inside x-for)', async () => {
      container.innerHTML = `
        <div x-data="{ rows: [{ id: 1, cols: ['a', 'b'] }, { id: 2, cols: ['c', 'd'] }] }">
          <template x-for="row in rows" :key="row.id">
            <div class="row">
              <template x-for="col in row.cols" :key="col">
                <span class="col" x-text="col"></span>
              </template>
            </div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const cols = container.querySelectorAll('.col');
      expect(cols.length).toBe(4);
      expect(cols[0].textContent).toBe('a');
      expect(cols[1].textContent).toBe('b');
      expect(cols[2].textContent).toBe('c');
      expect(cols[3].textContent).toBe('d');
    });

    it('should swap rows efficiently', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{id: 1, name: 'A'}, {id: 2, name: 'B'}, {id: 3, name: 'C'}] }">
          <button @click="items = [items[0], items[2], items[1]]">Swap B and C</button>
          <template x-for="item in items" :key="item.id">
            <div class="item" x-text="item.name"></div>
          </template>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      // Get initial elements
      let items = container.querySelectorAll('.item');
      const elementB = items[1];
      const elementC = items[2];

      const button = container.querySelector('button');
      button?.click();
      await Promise.resolve();

      // Elements should be swapped, not recreated
      items = container.querySelectorAll('.item');
      expect(items[1].textContent).toBe('C');
      expect(items[2].textContent).toBe('B');

      // Verify DOM elements are the same instances (moved, not recreated)
      expect(items[1]).toBe(elementC);
      expect(items[2]).toBe(elementB);
    });
  });

  describe('Nested x-data scope chain', () => {
    it('should read parent scope variables from nested x-data', async () => {
      container.innerHTML = `
        <div x-data="{ outer: 'hello' }">
          <div x-data="{ inner: 'world' }">
            <span id="s1" x-text="outer"></span>
            <span id="s2" x-text="inner"></span>
          </div>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      expect(container.querySelector('#s1')?.textContent).toBe('hello');
      expect(container.querySelector('#s2')?.textContent).toBe('world');
    });

    it('should write to parent scope signal from nested x-data @click', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <div x-data="{ step: 2 }">
            <button @click="count += step">Add</button>
          </div>
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      const span = container.querySelector('span');

      expect(span?.textContent).toBe('0');
      button?.click();
      await Promise.resolve();
      expect(span?.textContent).toBe('2');
    });

    it('should bind x-model in nested x-data to parent scope signal', async () => {
      container.innerHTML = `
        <div x-data="{ name: 'Alice' }">
          <div x-data="{ label: 'Name' }">
            <input type="text" x-model="name">
          </div>
          <span x-text="name"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const input = container.querySelector('input') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('Alice');

      input.value = 'Bob';
      input.dispatchEvent(new Event('input'));
      await Promise.resolve();

      expect(span?.textContent).toBe('Bob');
    });

    it('should correctly write NaN from number input x-model bound to parent scope variable', async () => {
      // JSON.stringify(NaN) === 'null', so the mkExec fallback used to corrupt NaN into null
      // when the model variable lives in a parent scope (not the immediate scope).
      container.innerHTML = `
        <div x-data="{ outer: 5 }">
          <div x-data="{ inner: 1 }">
            <input type="number" id="inp" x-model="outer">
          </div>
          <span x-text="String(outer)"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const input = container.querySelector('#inp') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('5');
      expect(span?.textContent).toBe('5');

      // Simulate entering an invalid number → valueAsNumber is NaN
      input.value = 'abc';
      input.dispatchEvent(new Event('input'));
      await Promise.resolve();

      // Should propagate NaN (not null) to the parent scope
      expect(span?.textContent).toBe('NaN');
    });

    it('should support x-show in nested x-data using parent scope variable', async () => {
      container.innerHTML = `
        <div x-data="{ visible: true }">
          <div x-data="{ label: 'test' }">
            <span x-show="visible">Content</span>
          </div>
          <button @click="visible = false">Hide</button>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const span = container.querySelector('span') as HTMLElement;
      const button = container.querySelector('button');

      expect(span?.style.display).not.toBe('none');

      button?.click();
      await Promise.resolve();

      expect(span?.style.display).toBe('none');
    });

    it('should access parent scope from computed in nested x-data', async () => {
      container.innerHTML = `
        <div x-data="{ base: 10 }">
          <div x-data="{ multiplier: 3, result: () => base * multiplier }">
            <span x-text="result"></span>
          </div>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      expect(container.querySelector('span')?.textContent).toBe('30');
    });

    it('should support x-for inside nested x-data with item variables', async () => {
      container.innerHTML = `
        <div x-data="{ title: 'List' }">
          <div x-data="{ items: ['A', 'B', 'C'] }">
            <template x-for="item in items" :key="item">
              <span class="item" x-text="item"></span>
            </template>
          </div>
          <span id="title" x-text="title"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const items = container.querySelectorAll('.item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('A');
      expect(items[1].textContent).toBe('B');
      expect(items[2].textContent).toBe('C');
      expect(container.querySelector('#title')?.textContent).toBe('List');
    });

    it('should support x-model inside x-for inside nested x-data bound to ancestor scope (radio button scenario)', async () => {
      container.innerHTML = `
        <div x-data="{ active: 'radio2', plan: 'asd' }">
          <div x-data="{
            radios: [
              { title: 'Radio 1', value: 'radio1' },
              { title: 'Radio 2', value: 'radio2' }
            ]
          }">
            <template x-for="radio in radios" :key="radio.value">
              <label>
                <span class="title" x-text="radio.title"></span>
                <input
                  type="radio"
                  name="radios"
                  :id="radio.value"
                  :value="radio.value"
                  x-model="active"
                />
              </label>
            </template>
          </div>
          <span id="active" x-text="active"></span>
          <input type="text" id="plan" x-model="plan">
          <span id="plan-text" x-text="plan"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      // Labels and spans should be rendered from x-for
      const titles = container.querySelectorAll('.title');
      expect(titles.length).toBe(2);
      expect(titles[0].textContent).toBe('Radio 1');
      expect(titles[1].textContent).toBe('Radio 2');

      // Radio input ids/values should be bound
      const radio1 = container.querySelector('#radio1') as HTMLInputElement;
      const radio2 = container.querySelector('#radio2') as HTMLInputElement;
      expect(radio1).not.toBeNull();
      expect(radio2).not.toBeNull();
      expect(radio1.value).toBe('radio1');
      expect(radio2.value).toBe('radio2');

      // Initial active = 'radio2'
      expect(container.querySelector('#active')?.textContent).toBe('radio2');
      expect(radio1.checked).toBe(false);
      expect(radio2.checked).toBe(true);

      // Click radio1 — should update parent scope's `active`
      radio1.checked = true;
      radio1.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(container.querySelector('#active')?.textContent).toBe('radio1');
      expect(radio1.checked).toBe(true);
      expect(radio2.checked).toBe(false);

      // x-model on outer scope text input should still work
      const planInput = container.querySelector('#plan') as HTMLInputElement;
      expect(planInput.value).toBe('asd');
      planInput.value = 'newplan';
      planInput.dispatchEvent(new Event('input'));
      await Promise.resolve();
      expect(container.querySelector('#plan-text')?.textContent).toBe('newplan');
    });

    it('should not process nested x-data children with outer scope on re-init', async () => {
      container.innerHTML = `
        <div x-data="{ outer: 'yes' }">
          <div x-data="{ items: ['A', 'B'] }">
            <template x-for="item in items" :key="item">
              <span class="item" x-text="item"></span>
            </template>
          </div>
        </div>
      `;

      // First init
      K2.init(container);
      await Promise.resolve();

      let items = container.querySelectorAll('.item');
      expect(items.length).toBe(2);

      // Second init (simulates Livewire/framework re-initialization)
      // Should not produce errors or double-process x-for items
      K2.init(container);
      await Promise.resolve();

      // Items should still be correct (not doubled or errored)
      items = container.querySelectorAll('.item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe('A');
      expect(items[1].textContent).toBe('B');
    });

    it('should support 3-level nested x-data scope chain', async () => {
      container.innerHTML = `
        <div x-data="{ level1: 'L1' }">
          <div x-data="{ level2: 'L2' }">
            <div x-data="{ level3: 'L3' }">
              <span id="s1" x-text="level1"></span>
              <span id="s2" x-text="level2"></span>
              <span id="s3" x-text="level3"></span>
            </div>
          </div>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      expect(container.querySelector('#s1')?.textContent).toBe('L1');
      expect(container.querySelector('#s2')?.textContent).toBe('L2');
      expect(container.querySelector('#s3')?.textContent).toBe('L3');
    });

    it('should write to grandparent scope from 3-level nested @click', async () => {
      container.innerHTML = `
        <div x-data="{ count: 0 }">
          <div x-data="{ step: 2 }">
            <div x-data="{ label: 'Add' }">
              <button @click="count += step">Add</button>
            </div>
          </div>
          <span x-text="count"></span>
        </div>
      `;

      K2.init(container);
      await Promise.resolve();

      const button = container.querySelector('button');
      const span = container.querySelector('span');

      expect(span?.textContent).toBe('0');
      button?.click();
      await Promise.resolve();
      expect(span?.textContent).toBe('2');
    });

    it('should support x-model with deep property path (item.sub.value) inside x-for', async () => {
      container.innerHTML = `
        <div x-data="{ items: [{ id: 1, meta: { label: 'hello' } }] }">
          <template x-for="item in items" :key="item.id">
            <input class="inp" x-model="item.meta.label" type="text">
          </template>
          <span x-text="items[0].meta.label"></span>
        </div>
      `;

      K2.init(container);
      await new Promise(r => setTimeout(r, 0));

      const input = container.querySelector('.inp') as HTMLInputElement;
      const span = container.querySelector('span');

      expect(input?.value).toBe('hello');
      expect(span?.textContent).toBe('hello');

      input.value = 'world';
      input.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 0));

      expect(span?.textContent).toBe('world');
    });
  });
});
