// tests/navigation.test.js
// View switching: does clicking each nav item actually show the right
// panel and hide the others? Does the mobile sidebar close after a
// selection? These are the flows users do constantly and silently break
// when someone refactors setView().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootApp } from './helpers/boot.js';

const VIEWS = [
  { nav: 'pomodoro', panel: 'pomodoro-view' },
  { nav: 'calendar', panel: 'calendar-view' },
  { nav: 'notes', panel: 'notes-view' },
  { nav: 'settings', panel: 'settings-view' },
];

describe('navigation — view switching', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const { nav, panel } of VIEWS) {
    it(`clicking "${nav}" shows the ${panel} and hides the others`, async () => {
      await bootApp();
      document.querySelector(`.nav-item[data-view="${nav}"]`).click();

      // Target panel visible
      expect(document.getElementById(panel).style.display).not.toBe('none');
      // Task view hidden
      expect(document.getElementById('task-view').style.display).toBe('none');
      // Other tool panels hidden
      for (const other of VIEWS) {
        if (other.panel === panel) continue;
        expect(document.getElementById(other.panel).style.display).toBe('none');
      }
    });
  }

  it('clicking a tool view then "Home" returns to the task list', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();
    expect(document.getElementById('notes-view').style.display).not.toBe('none');

    document.getElementById('all-tasks-btn').click();
    expect(document.getElementById('task-view').style.display).not.toBe('none');
    expect(document.getElementById('notes-view').style.display).toBe('none');
  });

  it('clicking a sub-nav item (Today/Active/Completed) keeps the task view', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="active"]').click();
    expect(document.getElementById('task-view').style.display).not.toBe('none');
    expect(document.getElementById('view-title').textContent).toBe('Active');
  });

  it('clicking a sub-nav item marks it active and marks Home active too', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="today"]').click();
    const todayBtn = document.querySelector('.nav-item[data-view="today"]');
    const homeBtn = document.getElementById('all-tasks-btn');
    expect(todayBtn.classList.contains('active')).toBe(true);
    expect(homeBtn.classList.contains('active')).toBe(true);
  });

  it('the Home chevron expands the sub-nav', async () => {
    await bootApp();
    const chevron = document.getElementById('all-chevron');
    const subnav = document.getElementById('all-subnav');

    chevron.click();
    expect(subnav.classList.contains('open')).toBe(true);

    chevron.click();
    expect(subnav.classList.contains('open')).toBe(false);
  });

  it('switching to settings renders the settings UI', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="settings"]').click();
    // renderSettingsUI populates the theme buttons.
    expect(document.getElementById('theme-light-btn')).not.toBeNull();
    expect(document.getElementById('account-status').textContent.length).toBeGreaterThan(0);
  });

  it('switching to calendar renders the calendar grid', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="calendar"]').click();
    const cells = document.querySelectorAll('#calendar-grid .day-cell');
    // A month view renders between 28 and 42 cells.
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.length).toBeLessThanOrEqual(42);
  });

  it('switching to notes renders category tabs', async () => {
    await bootApp();
    document.querySelector('.nav-item[data-view="notes"]').click();
    const tabs = document.querySelectorAll('#category-tabs .category-tab');
    // At minimum an "All" tab plus the default "General" category.
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  it('mobile sidebar closes after selecting a view', async () => {
    await bootApp();
    // Simulate opening the sidebar, then selecting a view.
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('open');
    document.querySelector('.nav-item[data-view="notes"]').click();
    expect(sidebar.classList.contains('open')).toBe(false);
  });
});