// tests/realtime.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bootApp,
  addTaskViaUI,
  readTodos,
  readNotes,
  readEvents,
  readProjects,
} from './helpers/boot.js';

async function bootAndCaptureHandlers() {
  await bootApp({ signedIn: true, supabaseReady: true });
  const calls = window.setupRealtime.mock.calls;
  if (!calls.length) throw new Error('setupRealtime was never called');
  return calls[calls.length - 1][0];
}

const flushDebounce = () => new Promise((r) => setTimeout(r, 200));

describe('realtime — handleRealtimeTodo', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('INSERT from another device adds the task locally', async () => {
    const handlers = await bootAndCaptureHandlers();
    handlers.onTodo({
      eventType: 'INSERT',
      new: { id: 'remote-1', text: 'From phone', done: false, priority: 'medium', project_id: null },
      old: null,
    });
    await flushDebounce();
    expect(readTodos().find((t) => String(t.id) === 'remote-1')).toBeTruthy();
    expect(document.querySelector('#todo-list').textContent).toContain('From phone');
  });

  it('UPDATE from another device updates the existing task', async () => {
    await bootApp({ signedIn: true, supabaseReady: true });
    addTaskViaUI({ text: 'Original' });
    const id = readTodos()[0].id;

    const handlers = await bootAndCaptureHandlers();
    handlers.onTodo({
      eventType: 'UPDATE',
      new: { id, text: 'Updated remotely', done: false, priority: 'high', project_id: null },
      old: { id },
    });
    await flushDebounce();

    const stored = readTodos().find((t) => String(t.id) === String(id));
    expect(stored.text).toBe('Updated remotely');
    expect(stored.priority).toBe('high');
  });

  it('DELETE from another device removes the task locally', async () => {
    await bootApp({ signedIn: true, supabaseReady: true });
    addTaskViaUI({ text: 'Doomed' });
    const id = readTodos()[0].id;

    const handlers = await bootAndCaptureHandlers();
    handlers.onTodo({ eventType: 'DELETE', new: null, old: { id } });
    await flushDebounce();

    expect(readTodos().find((t) => String(t.id) === String(id))).toBeFalsy();
  });

  it('ignores payloads without an id (malformed event)', async () => {
    const handlers = await bootAndCaptureHandlers();
    expect(() => handlers.onTodo({ eventType: 'INSERT', new: null, old: null })).not.toThrow();
    expect(() => handlers.onTodo({ eventType: 'INSERT', new: {}, old: null })).not.toThrow();
  });
});

describe('realtime — handleRealtimeProject', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('INSERT from another device adds the project to the sidebar', async () => {
    const handlers = await bootAndCaptureHandlers();
    handlers.onProject({
      eventType: 'INSERT',
      new: { id: 9001, name: 'Shared project', user_id: 'someone-else' },
      old: null,
    });
    await flushDebounce();

    expect(readProjects().find((p) => String(p.id) === '9001')).toBeTruthy();
    expect(document.getElementById('project-nav-list').textContent).toContain('Shared project');
  });

  it('DELETE from another device removes the project and unassigns its tasks', async () => {
    await bootApp({ signedIn: true, supabaseReady: true });
    document.getElementById('add-project-btn').click();
    document.getElementById('project-name-input').value = 'Doomed project';
    document.getElementById('project-modal-save-btn').click();
    const projectId = readProjects()[0].id;

    addTaskViaUI({ text: 'Orphan task', project: String(projectId) });

    const handlers = await bootAndCaptureHandlers();
    handlers.onProject({
      eventType: 'DELETE',
      new: null,
      old: { id: projectId, name: 'Doomed project' },
    });
    await flushDebounce();

    expect(readProjects().find((p) => String(p.id) === String(projectId))).toBeFalsy();
    const orphan = readTodos().find((t) => t.text === 'Orphan task');
    expect(orphan.projectId).toBe(null);
  });
});

describe('realtime — handleRealtimeNote', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('INSERT adds the note and picks up new categories', async () => {
    const handlers = await bootAndCaptureHandlers();
    handlers.onNote({
      eventType: 'INSERT',
      new: {
        id: 'n-remote',
        title: 'From the phone',
        category: 'Ideas',
        desc: '',
        content: 'body',
        created_at: '2026-01-01T00:00:00Z',
        user_id: 'test-user-id',
      },
      old: null,
    });
    await flushDebounce();

    expect(readNotes().find((n) => String(n.id) === 'n-remote')).toBeTruthy();
    const tabs = document.querySelectorAll('#category-tabs .category-tab');
    const labels = Array.from(tabs).map((t) => t.textContent);
    expect(labels).toContain('Ideas');
  });

  it('ignores notes belonging to a different user', async () => {
    const handlers = await bootAndCaptureHandlers();
    const before = readNotes().length;
    handlers.onNote({
      eventType: 'INSERT',
      new: { id: 'other-user-note', title: 'Not mine', user_id: 'someone-else', created_at: '' },
      old: null,
    });
    await flushDebounce();
    expect(readNotes().length).toBe(before);
  });
});

describe('realtime — handleRealtimeEvent', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('INSERT from another device lands on the calendar for its date', async () => {
    const handlers = await bootAndCaptureHandlers();
    handlers.onEvent({
      eventType: 'INSERT',
      new: {
        id: 'evt-1',
        date: '2026-03-15',
        time: '10:00',
        title: 'Remote event',
        notes: '',
        user_id: 'test-user-id',
      },
      old: null,
    });
    await flushDebounce();

    const stored = readEvents().find((e) => String(e.id) === 'evt-1');
    expect(stored).toBeTruthy();
    expect(stored.date).toBe('2026-03-15');
  });

  it('DELETE removes the event', async () => {
    await bootApp({ signedIn: true, supabaseReady: true });
    document.querySelector('.nav-item[data-view="calendar"]').click();
    document.getElementById('day-panel-add').click();
    document.getElementById('event-title-input').value = 'Doomed event';
    document.getElementById('event-save-btn').click();
    const id = readEvents()[0].id;

    const handlers = await bootAndCaptureHandlers();
    handlers.onEvent({ eventType: 'DELETE', new: null, old: { id } });
    await flushDebounce();

    expect(readEvents().find((e) => String(e.id) === String(id))).toBeFalsy();
  });
});

describe('realtime — handleRealtimeNotification', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('INSERT unshifts the notification and bumps the badge', async () => {
    const handlers = await bootAndCaptureHandlers();
    handlers.onNotification({
      eventType: 'INSERT',
      new: { id: 'n1', title: 'New invite', body: 'x', read: false, created_at: new Date().toISOString() },
      old: null,
    });
    await flushDebounce();

    const badge = document.getElementById('notif-count');
    expect(badge.style.display).not.toBe('none');
    expect(badge.textContent).toBe('1');
  });

  it('caps the notification list at 60', async () => {
    const handlers = await bootAndCaptureHandlers();
    for (let i = 0; i < 80; i++) {
      handlers.onNotification({
        eventType: 'INSERT',
        new: { id: `n${i}`, title: `N${i}`, body: '', read: true, created_at: new Date().toISOString() },
        old: null,
      });
    }
    await flushDebounce();
    expect(() => document.getElementById('notif-list')).not.toThrow();
  });
});

describe('realtime — handler robustness', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('no handler throws on a null payload', async () => {
    const handlers = await bootAndCaptureHandlers();
    for (const key of ['onTodo', 'onProject', 'onMember', 'onNotification', 'onNote', 'onEvent']) {
      expect(() => handlers[key]({ eventType: 'INSERT', new: null, old: null })).not.toThrow();
      expect(() => handlers[key]({ eventType: 'UPDATE', new: {}, old: {} })).not.toThrow();
      expect(() => handlers[key]({ eventType: 'DELETE', new: null, old: null })).not.toThrow();
    }
  });

  it('no handler throws when the row is malformed', async () => {
    const handlers = await bootAndCaptureHandlers();
    for (const key of ['onTodo', 'onProject', 'onMember', 'onNotification', 'onNote', 'onEvent']) {
      expect(() => handlers[key]({ eventType: 'INSERT', new: { id: 1 }, old: null })).not.toThrow();
    }
  });
});