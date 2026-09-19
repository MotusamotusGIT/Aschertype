// tests/cross-view.test.js
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

describe('cross-view — task appears in the right views', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a task with due=today appears in both Home and Today', async () => {
    await bootApp();
    const today = new Date().toISOString().slice(0, 10);
    addTaskViaUI({ text: 'Due today', due: today });

    expect(document.querySelector('#todo-list').textContent).toContain('Due today');

    document.querySelector('.nav-item[data-view="today"]').click();
    expect(document.querySelector('#todo-list').textContent).toContain('Due today');
  });

  it('marking a task done removes it from Active view', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Toggle me' });
    const cb = document.querySelector('#todo-list .task-check');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('.nav-item[data-view="active"]').click();
    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(0);
  });

  it('a task in a project shows a project pill on Home', async () => {
    await bootApp();
    document.getElementById('add-project-btn').click();
    document.getElementById('project-name-input').value = 'Work';
    document.getElementById('project-modal-save-btn').click();
    const projectId = String(readProjects()[0].id);

    addTaskViaUI({ text: 'Project task', project: projectId });
    const card = document.querySelector('#todo-list .task-card');
    expect(card.textContent).toContain('Work');
  });

  it('deleting a project removes the pill from its task on Home', async () => {
    await bootApp();
    document.getElementById('add-project-btn').click();
    document.getElementById('project-name-input').value = 'Temp';
    document.getElementById('project-modal-save-btn').click();
    const projectId = String(readProjects()[0].id);

    addTaskViaUI({ text: 'Orphan', project: projectId });
    window.confirm = () => true;
    document.querySelector(`.nav-item.project-item[data-project-id="${projectId}"]`).click();
    document.getElementById('project-delete-btn').click();

    const card = document.querySelector('#todo-list .task-card');
    expect(card.textContent).not.toContain('Temp');
  });
});

describe('cross-view — full round-trip with every feature', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('task + note + event + project all survive a reload together', async () => {
    await bootApp();

    document.getElementById('add-project-btn').click();
    document.getElementById('project-name-input').value = 'Side project';
    document.getElementById('project-modal-save-btn').click();

    addTaskViaUI({ text: 'Ship it', priority: 'high' });

    document.querySelector('.nav-item[data-view="notes"]').click();
    document.getElementById('note-title-input').value = 'Meeting notes';
    document.getElementById('note-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );

    document.querySelector('.nav-item[data-view="calendar"]').click();
    document.getElementById('day-panel-add').click();
    document.getElementById('event-title-input').value = 'Launch day';
    document.getElementById('event-save-btn').click();

    const snapshot = {
      todos: localStorage.getItem('todos'),
      notes: localStorage.getItem('notes'),
      events: localStorage.getItem('events'),
      projects: localStorage.getItem('projects'),
    };

    freshDom();
    localStorage.setItem('todos', snapshot.todos);
    localStorage.setItem('notes', snapshot.notes);
    localStorage.setItem('events', snapshot.events);
    localStorage.setItem('projects', snapshot.projects);
    await bootApp();

    expect(document.querySelector('#todo-list').textContent).toContain('Ship it');
    expect(document.getElementById('project-nav-list').textContent).toContain('Side project');
    expect(readTodos()).toHaveLength(1);
    expect(readNotes()).toHaveLength(1);
    expect(readEvents()).toHaveLength(1);
    expect(readProjects()).toHaveLength(1);
  });

  it('counts stay consistent across every sidebar view', async () => {
    await bootApp();
    const today = new Date().toISOString().slice(0, 10);
    addTaskViaUI({ text: 'A' });
    addTaskViaUI({ text: 'B', due: today });
    addTaskViaUI({ text: 'C' });

    const boxes = document.querySelectorAll('#todo-list .task-check');
    boxes[2].checked = true;
    boxes[2].dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(document.getElementById('count-all').textContent).toBe('3');
    expect(document.getElementById('count-today').textContent).toBe('1');
    expect(document.getElementById('count-active').textContent).toBe('2');
    expect(document.getElementById('count-completed').textContent).toBe('1');
  });
});

describe('cross-view — filters don\'t corrupt state', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('switching from Active to Completed to All preserves all tasks', async () => {
    await bootApp();
    addTaskViaUI({ text: 'A' });
    addTaskViaUI({ text: 'B' });
    const boxes = document.querySelectorAll('#todo-list .task-check');
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('.nav-item[data-view="active"]').click();
    document.querySelector('.nav-item[data-view="completed"]').click();
    document.getElementById('all-tasks-btn').click();

    expect(document.querySelectorAll('#todo-list .task-card').length).toBe(2);
    expect(readTodos()).toHaveLength(2);
  });

  it('clear-completed from any view leaves active tasks intact', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Keep me' });
    addTaskViaUI({ text: 'Drop me' });
    const boxes = document.querySelectorAll('#todo-list .task-check');
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new window.Event('change', { bubbles: true }));

    document.getElementById('clear-completed').click();

    expect(readTodos()).toHaveLength(1);
    expect(readTodos()[0].text).toBe('Keep me');
  });
});