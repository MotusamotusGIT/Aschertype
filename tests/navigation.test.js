// tests/navigation.test.js
// View switching: does clicking each nav item actually show the right
// panel, hide the others, update the header, and clean up its own state?
// These are the flows users do constantly and silently break when
// someone refactors setView().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootApp, addTaskViaUI, readTodos } from './helpers/boot.js';

const TOOL_VIEWS = [
  { nav: 'pomodoro', panel: 'pomodoro-view' },
  { nav: 'calendar', panel: 'calendar-view' },
  { nav: 'notes', panel: 'notes-view' },
  { nav: 'settings', panel: 'settings-view' },
];

const TASK_VIEWS = [
  { nav: 'today', title: 'Today' },
  { nav: 'active', title: 'Active' },
  { nav: 'completed', title: 'Completed' },
];

const ALL_PANELS = ['task-view', 'pomodoro-view', 'calendar-view', 'notes-view', 'settings-view'];

function visiblePanels() {
  return ALL_PANELS.filter((id) => document.getElementById(id).style.display !== 'none');
}

describe('navigation — tool view switching', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const { nav, panel } of TOOL_VIEWS) {
    it(`clicking "${nav}" shows ONLY the ${panel}`, async () => {
      await bootApp();
      document.querySelector(`.nav-item[data-view="${nav}"]`).click();

      // Exactly one panel visible.
      expect(visiblePanels()).toEqual([panel]);
    });
  }

  it('switching between tool views in sequence leaves exactly one visible', async () => {
    await bootApp();
    for (const { nav, panel } of TOOL_VIEWS) {
      document.querySelector(`.nav-item[data-view="${nav}"]`).click();
      expect(visiblePanels()).toEqual([panel]);
    }
  });

  it('clicking the same tool view twice is idempotent', async () => {
    await bootApp();
    const nav = document.querySelector('.nav-item[data-view="notes"]');
    nav.click();
    const first = visiblePanels();
    nav.click();
    expect(visiblePanels()).toEqual(first);
    expect(visiblePanels()).toEqual(['notes-view']);
  });

  it('returning Home from a tool view shows the task panel only', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="calendar"]').click();
    expect(visiblePanels()).toEqual(['calendar-view']);

    document.getElementById('all-tasks-btn').click();
    expect(visiblePanels()).toEqual(['task-view']);
  });
});

describe('navigation — sub-nav (task filters)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const { nav, title } of TASK_VIEWS) {
    it(`clicking "${nav}" keeps the task panel visible and sets the title to "${title}"`, async () => {
      await bootApp();
      document.querySelector(`.nav-item[data-view="${nav}"]`).click();

      expect(visiblePanels()).toEqual(['task-view']);
      expect(document.getElementById('view-title').textContent).toBe(title);
    });
  }

  it('the active nav item actually changes when switching sub-views', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="today"]').click();
    document.querySelector('.nav-item[data-view="completed"]').click();

    const todayBtn = document.querySelector('.nav-item[data-view="today"]');
    const completedBtn = document.querySelector('.nav-item[data-view="completed"]');
    expect(todayBtn.classList.contains('active')).toBe(false);
    expect(completedBtn.classList.contains('active')).toBe(true);
  });

  it('Home button stays active while a sub-view is selected', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="active"]').click();
    expect(document.getElementById('all-tasks-btn').classList.contains('active')).toBe(true);
  });

  it('switching from a tool view to a sub-view swaps panels correctly', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="settings"]').click();
    expect(visiblePanels()).toEqual(['settings-view']);

    document.querySelector('.nav-item[data-view="today"]').click();
    expect(visiblePanels()).toEqual(['task-view']);
    expect(document.getElementById('view-title').textContent).toBe('Today');
  });
});

describe('navigation — Home chevron', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the chevron expands and collapses the sub-nav without changing the view', async () => {
    await bootApp();
    const chevron = document.getElementById('all-chevron');
    const subnav = document.getElementById('all-subnav');

    // Move to a tool view first so we can prove the chevron doesn't change it.
    document.querySelector('.nav-item[data-view="notes"]').click();
    expect(visiblePanels()).toEqual(['notes-view']);

    chevron.click();
    expect(subnav.classList.contains('open')).toBe(true);
    expect(visiblePanels()).toEqual(['notes-view']);

    chevron.click();
    expect(subnav.classList.contains('open')).toBe(false);
    expect(visiblePanels()).toEqual(['notes-view']);
  });

  it('the chevron rotates visually (class toggles)', async () => {
    await bootApp();
    const chevron = document.getElementById('all-chevron');
    chevron.click();
    expect(chevron.classList.contains('open')).toBe(true);
    chevron.click();
    expect(chevron.classList.contains('open')).toBe(false);
  });
});

describe('navigation — tool-specific render side effects', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('calendar renders a valid grid AND a day panel with today selected', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="calendar"]').click();

    const cells = document.querySelectorAll('#calendar-grid .day-cell');
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.length).toBeLessThanOrEqual(42);
    expect(cells.length % 7).toBe(0);

    // The month label has content (month + year).
    expect(document.getElementById('cal-month-label').textContent.length).toBeGreaterThan(0);

    // Today is highlighted.
    const todayCell = document.querySelector('#calendar-grid .day-cell.today');
    expect(todayCell).not.toBeNull();

    // Day panel header has the selected date text.
    expect(document.getElementById('day-panel-date').textContent.length).toBeGreaterThan(0);
  });

  it('notes renders the "All" tab and the default category tab', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();

    const tabs = Array.from(document.querySelectorAll('#category-tabs .category-tab'));
    const labels = tabs.map((t) => t.textContent);
    expect(labels).toContain('All');
    expect(labels).toContain('General');
  });

  it('settings renders the current theme choice as active', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="settings"]').click();

    const light = document.getElementById('theme-light-btn');
    const dark = document.getElementById('theme-dark-btn');
    // Exactly one is active.
    const lightActive = light.classList.contains('active');
    const darkActive = dark.classList.contains('active');
    expect(lightActive !== darkActive).toBe(true);
  });

  it('switching to a view does not clear in-progress state on another view', async () => {
    await bootApp();
    addTaskViaUI({ text: 'Persistent task' });

    document.querySelector('.nav-item[data-view="notes"]').click();
    document.querySelector('.nav-item[data-view="calendar"]').click();
    document.querySelector('.nav-item[data-view="settings"]').click();
    document.getElementById('all-tasks-btn').click();

    expect(readTodos()).toHaveLength(1);
    expect(document.querySelector('#todo-list').textContent).toContain('Persistent task');
  });
});

describe('navigation — sidebar close behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('selecting a tool view closes the sidebar', async () => {
    await bootApp();
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('open');
    document.querySelector('.nav-item[data-view="notes"]').click();
    expect(sidebar.classList.contains('open')).toBe(false);
  });

  it('selecting a sub-view closes the sidebar', async () => {
    await bootApp();
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('open');
    document.querySelector('.nav-item[data-view="active"]').click();
    expect(sidebar.classList.contains('open')).toBe(false);
  });

  it('clicking the menu toggle opens the sidebar and the backdrop', async () => {
    await bootApp();
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    document.getElementById('menu-toggle').click();
    expect(sidebar.classList.contains('open')).toBe(true);
    expect(backdrop.classList.contains('show')).toBe(true);
  });

  it('clicking the backdrop closes the sidebar', async () => {
    await bootApp();
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    document.getElementById('menu-toggle').click();
    backdrop.click();
    expect(sidebar.classList.contains('open')).toBe(false);
    expect(backdrop.classList.contains('show')).toBe(false);
  });
});