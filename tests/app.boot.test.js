// tests/app.boot.test.js
// Smoke test: does the app boot? And does index.html contain every id
// that renderer.js dereferences? If this file goes red, nothing else
// matters.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HTML_PATH,
  ROOT,
  loadIndexHtml,
  installAppGlobals,
  loadRenderer,
  bootApp,
} from './helpers/boot.js';

/* ------------------------------------------------------------------ */
/* Every id renderer.js touches. If any is missing from index.html,    */
/* the app crashes at boot the way it did the first time we ran it.    */
/* ------------------------------------------------------------------ */
const REQUIRED_IDS = [
  // loading screen
  'loading-screen', 'loading-continue', 'loading-status', 'status-text', 'status-dot',
  // theme
  'theme-light-btn', 'theme-dark-btn',
  // account
  'account-status', 'account-signout-btn', 'account-switch-btn',
  // sidebar / nav
  'sidebar', 'sidebar-backdrop', 'menu-toggle',
  'all-tasks-btn', 'all-chevron', 'all-subnav',
  'count-all', 'count-today', 'count-active', 'count-completed',
  'project-nav-list', 'project-empty-hint', 'add-project-btn',
  'closeout-btn', 'clear-completed',
  // profile
  'profile-chip', 'mobile-profile-chip',
  'profile-avatar', 'mobile-profile-avatar', 'profile-name',
  'profile-overlay', 'profile-popover',
  'profile-pop-name-edit', 'profile-pop-avatar', 'profile-pop-name',
  'profile-pop-email', 'profile-edit-name-btn', 'profile-settings-btn',
  'profile-signout-btn', 'profile-signin-btn',
  'profile-name-input', 'profile-name-cancel', 'profile-name-save',
  // top bar / notifications
  'notif-bell', 'mobile-notif-bell', 'notif-count', 'mobile-notif-count',
  'notif-overlay', 'notif-list', 'notif-close-btn', 'notif-mark-all-btn',
  // task view
  'task-view', 'project-view-layout',
  'view-title', 'view-subtitle', 'project-header-actions',
  'project-rename-btn', 'project-delete-btn',
  'home-summary', 'home-greeting', 'home-pulse-today', 'home-pulse-active', 'home-pulse-week',
  'task-add', 'task-add-toggle', 'todo-form', 'todo-input', 'desc-input',
  'due-input', 'priority-input', 'todo-project-select',
  'todo-category-select', 'todo-add-category-btn',
  'task-add-cancel', 'todo-list', 'empty-state',
  // collab
  'project-collab-panel', 'collab-backdrop', 'collab-body', 'collab-empty',
  'collab-invite-btn', 'collab-fab', 'collab-fab-count',
  // task detail
  'task-detail-overlay', 'task-detail-check', 'task-detail-title',
  'task-detail-desc', 'task-detail-due', 'task-detail-priority',
  'task-detail-project', 'task-detail-category', 'task-detail-add-category-btn',
  'task-detail-close', 'task-detail-save-btn', 'task-detail-delete-btn',
  // pomodoro
  'pomodoro-view', 'pomodoro-task', 'pomodoro-timer', 'pomodoro-mode-label',
  'pomodoro-start', 'pomodoro-pause', 'pomodoro-reset',
  'pomodoro-work-min', 'pomodoro-break-min', 'pomodoro-sessions',
  // calendar
  'calendar-view', 'calendar-subtitle', 'calendar-grid', 'cal-month-label',
  'cal-prev', 'cal-next', 'cal-today-btn',
  'day-panel-header-list', 'day-panel-date', 'day-panel-sub',
  'day-panel-list', 'day-panel-add', 'day-panel-form', 'event-form-title',
  'event-time-input', 'event-title-input', 'event-notes-input',
  'event-save-btn', 'event-back-btn', 'event-delete-btn',
  // notes
  'notes-view', 'category-tabs', 'add-category-btn',
  'note-form', 'note-title-input', 'note-category-select', 'note-desc-input',
  'note-content-input', 'notes-list', 'notes-empty-state',
  // settings
  'settings-view',
  'closeout-time-input', 'closeout-enabled-input',
  'notifications-enabled-input', 'notif-permission-hint',
  'tips-enabled-input', 'encouragement-enabled-input',
  // modals
  'closeout-overlay', 'closeout-list', 'closeout-empty',
  'closeout-close-btn', 'closeout-move-all-btn', 'closeout-done-btn',
  'project-modal-overlay', 'project-modal-title', 'project-modal-close-btn',
  'project-preview-tile', 'project-name-input',
  'project-modal-cancel-btn', 'project-modal-save-btn',
  'invite-overlay', 'invite-modal-title', 'invite-modal-sub',
  'invite-close-btn', 'invite-error', 'invite-email',
  'invite-can-add-task', 'invite-can-rename-task',
  'invite-can-remove-task', 'invite-can-rename-project',
  'invite-cancel-btn', 'invite-send-btn',
  'welcome-overlay', 'welcome-dismiss-btn',
  'tips-intro-overlay', 'tips-intro-dismiss-btn',
  'perm-popover', 'perm-popover-email',
  // misc
  'toast-container', 'tips-bar', 'tips-text', 'tips-refresh-btn',
];

describe('index.html — element coverage', () => {
  beforeEach(() => loadIndexHtml());

  it('contains every id renderer.js depends on', () => {
    const missing = REQUIRED_IDS.filter((id) => document.getElementById(id) === null);
    expect(missing, `Missing ids in index.html:\n  - ${missing.join('\n  - ')}`).toEqual([]);
  });
});

describe('app boot', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads renderer.js without throwing', () => {
    loadIndexHtml();
    installAppGlobals();
    expect(() => loadRenderer()).not.toThrow();
  });

  it('exposes window.initApp after renderer.js runs', () => {
    loadIndexHtml();
    installAppGlobals();
    loadRenderer();
    expect(typeof window.initApp).toBe('function');
  });

  it('initApp(null) completes without throwing', async () => {
    await expect(bootApp()).resolves.toBeUndefined();
  });

  it('renders the task list container after boot', async () => {
    await bootApp();
    expect(document.getElementById('todo-list')).not.toBeNull();
    expect(document.getElementById('empty-state').style.display).not.toBe('none');
  });

  it('renders all four sidebar counts', async () => {
    await bootApp();
    expect(document.getElementById('count-all').textContent).toBe('0');
    expect(document.getElementById('count-today').textContent).toBe('0');
    expect(document.getElementById('count-active').textContent).toBe('0');
    expect(document.getElementById('count-completed').textContent).toBe('0');
  });

  it('boots cleanly when signed in', async () => {
    await bootApp({ signedIn: true });
    // Profile chip should be visible when signed in.
    const chip = document.getElementById('profile-chip');
    expect(chip.classList.contains('hidden')).toBe(false);
  });

  it('surfaces the welcome modal on first launch', async () => {
    // welcomeOverlay is shown via a setTimeout in initApp; advance past it.
    vi.useFakeTimers();
    try {
      await bootApp();
      vi.advanceTimersByTime(1000);
      expect(document.getElementById('welcome-overlay').style.display).toBe('flex');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not crash when switching views', async () => {
    await bootApp();
    for (const view of ['pomodoro', 'calendar', 'notes', 'settings', 'all']) {
      expect(() => {
        document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
      }).not.toThrow();
    }
  });
});