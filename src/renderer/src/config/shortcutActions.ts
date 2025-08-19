import eventBus from '@/utils/eventBus'
import type { ShortcutAction } from '@/services/shortcutService'

export const shortcutHints = {
  sendOrToggleAi: {
    zh: '与AI对话',
    en: 'Chat With AI'
  },
  openCommandDialog: {
    zh: '内联命令生成',
    en: 'Inline Command Generator'
  },
  openSettings: {
    zh: '打开设置',
    en: 'Open Settings'
  }
}

/**
 * Centralized definition of all keyboard shortcuts in the application.
 * Each action contains a unique `id`, a `nameKey` for internationalization,
 * default keyboard shortcuts `defaultKey` (different for Mac and non-Mac platforms),
 * and a `handler` function to execute the specific operation.
 */
export const shortcutActions: Omit<ShortcutAction, 'name'>[] = [
  {
    id: 'openSettings',
    nameKey: 'shortcuts.actions.openSettings',
    defaultKey: {
      mac: 'Command+,',
      other: 'Ctrl+,'
    },
    handler: () => {
      eventBus.emit('openUserTab', 'userConfig')
    }
  },
  {
    id: 'toggleLeftSidebar',
    nameKey: 'shortcuts.actions.toggleLeftSidebar',
    defaultKey: {
      mac: 'Command+B',
      other: 'Ctrl+B'
    },
    handler: () => {
      eventBus.emit('toggleSideBar', 'left')
    }
  },
  {
    id: 'toggleRightSidebar',
    nameKey: 'shortcuts.actions.toggleRightSidebar',
    defaultKey: {
      mac: 'Command+Option+B',
      other: 'Ctrl+Alt+B'
    },
    handler: () => {
      eventBus.emit('toggleSideBar', 'right')
    }
  },
  {
    id: 'sendOrToggleAi',
    nameKey: 'shortcuts.actions.sendOrToggleAi',
    defaultKey: {
      mac: 'Command+L',
      other: 'Ctrl+L'
    },
    handler: () => {
      eventBus.emit('sendOrToggleAiFromTerminal')
    }
  },
  {
    id: 'switchToNextTab',
    nameKey: 'shortcuts.actions.switchToNextTab',
    defaultKey: {
      mac: 'Control+Tab',
      other: 'Ctrl+Tab'
    },
    handler: () => {
      eventBus.emit('switchToNextTab')
    }
  },
  {
    id: 'switchToPrevTab',
    nameKey: 'shortcuts.actions.switchToPrevTab',
    defaultKey: {
      mac: 'Control+Shift+Tab',
      other: 'Ctrl+Shift+Tab'
    },
    handler: () => {
      eventBus.emit('switchToPrevTab')
    }
  },
  {
    id: 'switchToSpecificTab',
    nameKey: 'shortcuts.actions.switchToSpecificTab',
    defaultKey: {
      mac: 'Command',
      other: 'Ctrl'
    },
    handler: () => {
      eventBus.emit('switchToSpecificTab')
    }
  },
  {
    id: 'openCommandDialog',
    nameKey: 'shortcuts.actions.openCommandDialog',
    defaultKey: {
      mac: 'Command+K',
      other: 'Ctrl+K'
    },
    handler: () => {
      eventBus.emit('openCommandDialog')
    }
  }
]
