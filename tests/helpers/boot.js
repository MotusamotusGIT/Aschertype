// tests/helpers/boot.js
// Shared harness for integration tests that boot the real renderer.js
// against the real index.html inside jsdom. Imported by app.boot.test.js,
// task-flows.test.js, persistence.test.js, and navigation.test.js.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const HERE = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

// tests/helpers/boot.js → ../../src
export const ROOT = resolve(HERE, '..', '..', 'src');
export const HTML_PATH = resolve(ROOT, 'index.html');

/**
 * Load index.html into document.body, stripping <script> tags so jsdom
 * doesn't try to fetch/execute anything. We wire up renderer.js manually.
 */
export function loadIndexHtml() {
  const raw = readFileSync(HTML_PATH, 'utf8');
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : raw;
  const withoutScripts = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = withoutScripts;
}

/**
 * Stub the globals auth.js / db.js would provide. renderer.js references
 * these at call time, so defining them on window is enough.
 */
export function installAppGlobals({ signedIn = false } = {}) {
  window.currentUser = signedIn
    ? { id: 'test-user-id', email: 'tester@example.com' }
    : null;
  window.isGuest = !signedIn;
  window.supabaseReady = false;
  window.currentProfile = signedIn
    ? { id: 'test-user-id', email: 'tester@example.com', display_name: null }
    : null;

  const ok = async () => ({ error: null });
  window.dbFetchTodos = vi.fn(async () => null);
  window.dbFetchAll = vi.fn(async () => null);
  window.dbFetchProjects = vi.fn(async () => null);
  window.dbFetchProjectMembers = vi.fn(async () => []);
  window.dbFetchNotifications = vi.fn(async () => []);
  window.dbFetchMyProfile = vi.fn(async () => null);
  window.dbUpsert = vi.fn(ok);
  window.dbUpsertMyProfile = vi.fn(ok);
  window.dbUpdate = vi.fn(ok);
  window.dbDelete = vi.fn(ok);
  window.dbDeleteWhere = vi.fn(ok);
  window.dbUpsertProjectMember = vi.fn(ok);
  window.dbUpdateProjectMember = vi.fn(ok);
  window.dbDeleteProjectMember = vi.fn(ok);
  window.dbRespondToInvite = vi.fn(ok);
  window.dbMarkNotificationRead = vi.fn(ok);
  window.setupRealtime = vi.fn();
  window.teardownRealtime = vi.fn();
  window.signOutAndReset = vi.fn();
}

/**
 * Load renderer.js into the jsdom window. We can't `import` it because
 * it's a classic script touching document at module scope. Eval it in a
 * wrapper so top-level `const`/`let` don't collide across reloads.
 */
export function loadRenderer() {
  const src = readFileSync(resolve(ROOT, 'renderer.js'), 'utf8');
  const wrapped = `(function(){\n${src}\n})();`;
  // eslint-disable-next-line no-new-func
  new Function(
    'window', 'document', 'navigator', 'localStorage',
    'sessionStorage', 'location', 'Notification', 'AudioContext',
    wrapped,
  )(
    window, window.document, window.navigator, window.localStorage,
    window.sessionStorage, window.location, window.Notification,
    window.AudioContext,
  );
}

/**
 * Full boot: HTML + globals + renderer + initApp. Returns once the app
 * has finished its startup sequence and the DOM reflects initial state.
 */
export async function bootApp({ signedIn = false } = {}) {
  loadIndexHtml();
  installAppGlobals({ signedIn });
  loadRenderer();
  await window.initApp(signedIn ? window.currentUser : null);
}

/**
 * Add a task through the UI (not by poking state). Returns once the DOM
 * has re-rendered.
 */
export function addTaskViaUI({
  text,
  desc = '',
  due = '',
  priority = 'medium',
  project = '',
  category = '',
} = {}) {
  document.getElementById('task-add-toggle').click();
  document.getElementById('todo-input').value = text;
  document.getElementById('desc-input').value = desc;
  document.getElementById('due-input').value = due;
  document.getElementById('priority-input').value = priority;
  document.getElementById('todo-project-select').value = project;
  document.getElementById('todo-category-select').value = category;
  document.getElementById('todo-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}

/** Read the persisted todos array from localStorage. */
export function readTodos() {
  return JSON.parse(localStorage.getItem('todos') || '[]');
}

/** Read the persisted notes array from localStorage. */
export function readNotes() {
  return JSON.parse(localStorage.getItem('notes') || '[]');
}

/** Read the persisted events array from localStorage. */
export function readEvents() {
  return JSON.parse(localStorage.getItem('events') || '[]');
}

/** Read the persisted projects array from localStorage. */
export function readProjects() {
  return JSON.parse(localStorage.getItem('projects') || '[]');
}