// tests/task-flows.test.js
// Covers the CRUD lifecycle of a task: create, read, update (inline and
// via the detail panel), toggle done, delete. Also covers form validation
// and the XSS-safe rendering path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bootApp,
  addTaskViaUI,
  readTodos,
} from './helpers/boot.js';

describe('task flows — create', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('adds a task via the UI and renders it', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Buy milk', priority: 'low' });

    const cards = document.querySelectorAll('#todo-list .task-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Buy milk');
    expect(cards[0].className).toContain('priority-low');
  });

  it('assigns due date and priority', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Call dentist', due: '2026-01-15', priority: 'high' });

    const stored = readTodos();
    expect(stored).toHaveLength(1);
    expect(stored[0].due).toBe('2026-01-15');
    expect(stored[0].priority).toBe('high');
  });

  it('renders a due-date pill on the card', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Submit report', due: '2026-02-01' });
    const card = document.querySelector('#todo-list .task-card');
    expect(card.querySelector('.task-pill')).not.toBeNull();
    expect(card.textContent).toContain('2026-02-01');
  });

  it('increments the active count after adding', async () => {
    await bootApp();
    addTaskViaUI({ text: 'One' });
    addTaskViaUI({ text: 'Two' });
    expect(document.getElementById('count-active').textContent).toBe('2');
    expect(document.getElementById('count-all').textContent).toBe('2');
  });

  it('closes the add form after submit', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Anything' });
    expect(document.getElementById('todo-form').hidden).toBe(true);
    expect(document.getElementById('task-add-toggle').hidden).toBe(false);
  });

  it('clears the input after submit', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Something' });
    document.getElementById('task-add-toggle').click();
    expect(document.getElementById('todo-input').value).toBe('');
  });

  it('ignores empty and whitespace-only titles', async () => {
    await bootApp();
    // whitespace-only
    document.getElementById('task-add-toggle').click();
    document.getElementById('todo-input').value = '    ';
    document.getElementById('todo-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(readTodos()).toHaveLength(0);
    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
  });

  it('escapes HTML in task titles (no XSS)', async () => {
    await bootApp();
    addTaskViaUI({ text: '<img src=x onerror=alert(1)>' });

    const card = document.querySelector('#todo-list .task-card');
    // The literal text should be present, but no <img> element should exist.
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.querySelector('img')).toBeNull();
  });
});

describe('task flows — toggle done', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('checking a task marks it done and updates counts', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Finish me' });
    const checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(document.getElementById('count-active').textContent).toBe('0');
    expect(document.getElementById('count-completed').textContent).toBe('1');
  });

  it('adds the completed class to the card', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Complete me' });
    const checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    const card = document.querySelector('#todo-list .task-card');
    expect(card.className).toContain('completed');
  });

  it('records completion in the completion log', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Track me' });
    const checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    const log = JSON.parse(localStorage.getItem('aschertypeCompletionLog') || '[]');
    expect(log.length).toBe(1);
  });

  it('un-checking returns the task to active', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Toggle me' });
    let checkbox = document.querySelector('#todo-list .task-check');

    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('count-completed').textContent).toBe('1');

    checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(document.getElementById('count-active').textContent).toBe('1');
    expect(document.getElementById('count-completed').textContent).toBe('0');
  });
});

describe('task flows — inline rename', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renames a task and persists the change', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Old name' });

    // Hover-revealed actions become clickable in jsdom regardless of CSS.
    const pencil = document.querySelector('#todo-list .task-icon-btn[title="Rename task"]');
    expect(pencil).not.toBeNull();
    pencil.click();

    const editInput = document.querySelector('.task-title-edit');
    expect(editInput).not.toBeNull();
    editInput.value = 'New name';
    editInput.dispatchEvent(new window.Event('blur'));

    expect(readTodos()[0].text).toBe('New name');
    expect(document.querySelector('#todo-list .task-title').textContent).toBe('New name');
  });

  it('escape key reverts an inline rename', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Keep this' });

    document.querySelector('#todo-list .task-icon-btn[title="Rename task"]').click();
    const editInput = document.querySelector('.task-title-edit');
    editInput.value = 'Discard this';
    editInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    expect(readTodos()[0].text).toBe('Keep this');
  });
});

describe('task flows — delete', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('deletes a task from the list and localStorage', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Delete me' });
    expect(readTodos()).toHaveLength(1);

    document.querySelector('#todo-list .task-icon-btn.delete-btn').click();

    expect(readTodos()).toHaveLength(0);
    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
    expect(document.getElementById('count-all').textContent).toBe('0');
  });
});

describe('task flows — detail panel', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the detail panel on card click', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Open me' });
    document.querySelector('#todo-list .task-card').click();
    expect(document.getElementById('task-detail-overlay').classList.contains('open')).toBe(true);
  });

  it('populates the detail panel with the task data', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Detailed task', desc: 'A description', due: '2026-03-01', priority: 'high' });
    document.querySelector('#todo-list .task-card').click();

    expect(document.getElementById('task-detail-title').value).toBe('Detailed task');
    expect(document.getElementById('task-detail-desc').value).toBe('A description');
    expect(document.getElementById('task-detail-due').value).toBe('2026-03-01');
    expect(document.getElementById('task-detail-priority').value).toBe('high');
  });

  it('saves edits from the detail panel', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Edit me' });
    document.querySelector('#todo-list .task-card').click();

    document.getElementById('task-detail-title').value = 'Edited';
    document.getElementById('task-detail-priority').value = 'low';
    document.getElementById('task-detail-save-btn').click();

    const stored = readTodos();
    expect(stored[0].text).toBe('Edited');
    expect(stored[0].priority).toBe('low');
    expect(document.getElementById('task-detail-overlay').classList.contains('open')).toBe(false);
  });

  it('deletes from the detail panel', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Remove me' });
    document.querySelector('#todo-list .task-card').click();
    document.getElementById('task-detail-delete-btn').click();

    expect(readTodos()).toHaveLength(0);
    expect(document.getElementById('task-detail-overlay').classList.contains('open')).toBe(false);
  });

  it('closes on Escape', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Close me' });
    document.querySelector('#todo-list .task-card').click();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('task-detail-overlay').classList.contains('open')).toBe(false);
  });

  it('toggling done from the panel updates the card', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Toggle via panel' });
    document.querySelector('#todo-list .task-card').click();

    const detailCheck = document.getElementById('task-detail-check');
    detailCheck.checked = true;
    detailCheck.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(readTodos()[0].done).toBe(true);
    expect(document.getElementById('count-completed').textContent).toBe('1');
  });
});

describe('task flows — filters', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('"Active" filter hides completed tasks', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Done task' });
    const checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('.nav-item[data-view="active"]').click();
    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
  });

  it('"Completed" filter shows only completed tasks', async () => {
    await bootApp();
    addTaskViaUI({ text: 'A' });
    addTaskViaUI({ text: 'B' });
    const firstCheckbox = document.querySelector('#todo-list .task-check');
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('.nav-item[data-view="completed"]').click();
    const cards = document.querySelectorAll('#todo-list .task-card');
    expect(cards.length).toBe(1);
  });

  it('clear-completed removes done tasks only', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Keep' });
    addTaskViaUI({ text: 'Delete' });
    // Complete the second one.
    const checkboxes = document.querySelectorAll('#todo-list .task-check');
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new window.Event('change', { bubbles: true }));

    document.getElementById('clear-completed').click();

    const stored = readTodos();
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Keep');
  });
});