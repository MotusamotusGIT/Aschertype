// tests/persistence.test.js
// Round-trip tests: state written by one app boot must be readable by
// the next. This is the class of bug users actually hit ("I added a task
// yesterday and it's gone"). Each test resets the DOM, replays the
// localStorage, and asserts the data survives.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bootApp,
  addTaskViaUI,
  readTodos,
  readNotes,
  readEvents,
  readProjects,
} from './helpers/boot.js';

function freshDom() {
  document.body.innerHTML = '';
}

describe('persistence — tasks', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a task added in one session renders in the next', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Survive reload', priority: 'high' });
    const stored = localStorage.getItem('todos');

    freshDom();
    localStorage.setItem('todos', stored);
    await bootApp();

    const card = document.querySelector('#todo-list .task-card');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Survive reload');
    expect(card.className).toContain('priority-high');
  });

  it('a completed task stays completed across reloads', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Remember done' });
    const checkbox = document.querySelector('#todo-list .task-check');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    const stored = localStorage.getItem('todos');
    freshDom();
    localStorage.setItem('todos', stored);
    await bootApp();

    expect(document.getElementById('count-completed').textContent).toBe('1');
    expect(document.querySelector('#todo-list .task-card').className).toContain('completed');
  });

  it('a deleted task stays deleted across reloads', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Ghost' });
    document.querySelector('#todo-list .task-icon-btn.delete-btn').click();
    const stored = localStorage.getItem('todos');

    freshDom();
    localStorage.setItem('todos', stored);
    await bootApp();

    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
  });
});

describe('persistence — notes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a note added in one session renders in the next', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();
    document.getElementById('note-title-input').value = 'Persist me';
    document.getElementById('note-content-input').value = 'Note body';
    document.getElementById('note-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    const stored = localStorage.getItem('notes');

    freshDom();
    localStorage.setItem('notes', stored);
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();

    expect(document.querySelector('#notes-list').textContent).toContain('Persist me');
    expect(readNotes()).toHaveLength(1);
  });

  it('a deleted note stays deleted across reloads', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();
    document.getElementById('note-title-input').value = 'Delete me';
    document.getElementById('note-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    document.querySelector('#notes-list .delete-btn').click();
    const stored = localStorage.getItem('notes');

    freshDom();
    localStorage.setItem('notes', stored);
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();

    expect(document.querySelectorAll('.note-card').length).toBe(0);
  });
});

describe('persistence — calendar events', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('an event added in one session renders in the next', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="calendar"]').click();
    document.getElementById('day-panel-add').click();
    document.getElementById('event-title-input').value = 'Team sync';
    document.getElementById('event-time-input').value = '14:30';
    document.getElementById('event-save-btn').click();
    const stored = localStorage.getItem('events');

    freshDom();
    localStorage.setItem('events', stored);
    await bootApp();
    document.querySelector('.nav-item[data-view="calendar"]').click();

    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Team sync');
    expect(events[0].time).toBe('14:30');
  });
});

describe('persistence — projects', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a project created in one session renders in the next', async () => {
    await bootApp();
    document.getElementById('add-project-btn').click();
    document.getElementById('project-name-input').value = 'Website redesign';
    document.getElementById('project-modal-save-btn').click();
    const stored = localStorage.getItem('projects');

    freshDom();
    localStorage.setItem('projects', stored);
    await bootApp();

    const nav = document.getElementById('project-nav-list');
    expect(nav.textContent).toContain('Website redesign');
    expect(readProjects()).toHaveLength(1);
  });
});

describe('persistence — storage resilience', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('boots cleanly with corrupted todos JSON and clears the bad key', async () => {
    localStorage.setItem('todos', '{not valid json');
    await expect(bootApp()).resolves.toBeUndefined();
    expect(localStorage.getItem('todos')).toBe(null);
    // App boots with an empty task list.
    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
  });

  it('boots cleanly with corrupted notes JSON and clears the bad key', async () => {
    localStorage.setItem('notes', '<<<>>>');
    await expect(bootApp()).resolves.toBeUndefined();
    expect(localStorage.getItem('notes')).toBe(null);
  });

  it('boots cleanly with corrupted events JSON and clears the bad key', async () => {
    localStorage.setItem('events', 'not-json');
    await expect(bootApp()).resolves.toBeUndefined();
    expect(localStorage.getItem('events')).toBe(null);
  });

  it('boots cleanly when localStorage itself throws on read', async () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
    try {
      await expect(bootApp()).resolves.toBeUndefined();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});