import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderNoteEditorDrawer } from '../../src/features/reader/components/reader-note-editor-drawer';
import { ReaderNotesOverlay } from '../../src/features/reader/components/reader-notes-overlay';
import { MarkdownEditor } from '../../src/components/markdown';
import type { ReaderNote } from '../../src/features/reader/domain/reader-highlight';

const ui = vi.hoisted(() => ({
  cells: [] as unknown[], cursor: 0, effects: [] as (() => void)[], dirty: false,
  openStates: [] as boolean[], hosts: [] as string[], portal: '' ,
  buttons: new Map<string, { onPress: () => void; isDisabled?: boolean }>(),
  input: undefined as undefined | {
    value: string; onChangeText: (value: string) => void;
    maxLength?: number; placeholder?: string; onFocus?: () => void;
    onSelectionChange?: (event: { nativeEvent: { selection: { start: number; end: number } } }) => void;
    selection?: { start: number; end: number };
    formatSelection?: (text: string, start: number, end: number, command: string) => { updatedText: string; cursorOffset: number };
  },
  confirm: undefined as undefined | { isOpen: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void },
  toast: vi.fn(),
  measureQuote: undefined as undefined | ((event: { nativeEvent: { lines: unknown[] } }) => void),
  quoteLines: undefined as number | undefined,
  nativeInput: { focus: vi.fn(), setSelection: vi.fn() },
  notePortal: '' as string,
}));

vi.mock('expensify-common/ExpensiMark', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('expensify-common/ExpensiMark');
});
vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return { ...original,
    useState: (initial: unknown) => {
      const index = ui.cursor++;
      if (!(index in ui.cells)) ui.cells[index] = initial;
      return [ui.cells[index], (next: unknown) => { const value = typeof next === 'function' ? next(ui.cells[index]) : next; ui.dirty ||= !Object.is(value, ui.cells[index]); ui.cells[index] = value; }];
    },
    useRef: (initial: unknown) => {
      const index = ui.cursor++;
      if (!(index in ui.cells)) ui.cells[index] = { current: initial };
      return ui.cells[index];
    },
    useEffect: (effect: () => void, deps: unknown[]) => {
      const index = ui.cursor++;
      const previous = ui.cells[index] as unknown[] | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) ui.effects.push(effect);
      ui.cells[index] = deps;
    },
    useCallback: (callback: unknown) => callback,
  };
});
vi.mock('react-native', () => ({
  Text: ({ children, onTextLayout, selectable, numberOfLines }: {
    children: ReactNode; onTextLayout?: typeof ui.measureQuote; selectable?: boolean; numberOfLines?: number;
  }) => {
    if (onTextLayout) ui.measureQuote = onTextLayout;
    if (selectable) ui.quoteLines = numberOfLines;
    return <span>{children}</span>;
  },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Keyboard: { dismiss: vi.fn() }, BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ height: 844 }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('heroui-native/hooks', () => ({ useThemeColor: (tokens: unknown) => Array.isArray(tokens) ? tokens.map(() => '#fff') : '#fff', useBottomSheetAwareHandlers: () => ({ onFocus: vi.fn(), onBlur: vi.fn() }) }));
vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock('uniwind', () => ({ ScopedTheme: ({ children }: { children: ReactNode }) => children, useCSSVariable: () => '#0088ff', useUniwind: () => ({ theme: 'dark' }), withUniwind: (component: unknown) => component }));
vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  FadeIn: { duration: () => ({}) }, FadeOut: { duration: () => ({}) },
}));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('heroui-native/toast', () => ({ useToast: () => ({ toast: { show: ui.toast } }) }));
vi.mock('@expensify/react-native-live-markdown', () => ({ parseExpensiMark: vi.fn(), MarkdownTextInput: (props: typeof ui.input & { ref: { current: unknown } }) => { ui.input = props; props.ref.current = ui.nativeInput; return null; } }));
vi.mock('heroui-native/portal', () => ({
  Portal: ({ name, children }: { name: string; children: ReactNode }) => {
    ui.notePortal = name;
    return children;
  },
  PortalHost: ({ name }: { name: string }) => { ui.hosts.push(name); return null; },
}));
vi.mock('@/components/ui/confirm-modal', () => ({ ConfirmModal: (props: typeof ui.confirm) => { ui.confirm = props; return null; } }));
vi.mock('../../src/components/markdown/markdown-view', () => ({ MarkdownView: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('heroui-native/bottom-sheet', () => {
  const Container = ({ children }: { children: ReactNode }) => children;
  const Root = ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => { ui.openStates.push(isOpen); return isOpen ? children : null; };
  const Portal = ({ hostName, children }: { hostName: string; children: ReactNode }) => { ui.portal = hostName; return children; };
  return { BottomSheet: Object.assign(Root, { Portal, Content: Container, Title: Container, Overlay: () => null }) };
});
vi.mock('heroui-native/button', () => ({ Button: Object.assign((props: {
  children: ReactNode; accessibilityLabel?: string; onPress: () => void; isDisabled?: boolean;
}) => {
  const labelChild = Array.isArray(props.children) ? props.children.at(-1) : props.children;
  const label = props.accessibilityLabel ?? (typeof labelChild === 'string' ? labelChild
    : (labelChild as React.ReactElement<{ children: string }>).props.children);
  ui.buttons.set(label, props);
  return props.children;
}, { Label: ({ children }: { children: ReactNode }) => children }) }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  ui.effects = []; ui.openStates = []; ui.hosts = []; ui.dirty = false; ui.cells = []; ui.cursor = 0; ui.buttons.clear(); ui.toast.mockClear(); ui.input = undefined;
  ui.measureQuote = undefined; ui.quoteLines = undefined;
  ui.nativeInput.focus.mockClear(); ui.nativeInput.setSelection.mockClear();
  ui.notePortal = '';
});
afterEach(() => vi.unstubAllGlobals());

function renderTree(tree: ReactNode): string {
  let markup = '';
  for (let pass = 0; pass < 10; pass++) {
    ui.cursor = 0; ui.input = undefined; ui.dirty = false; ui.effects = [];
    markup = renderToStaticMarkup(tree);
    for (const effect of ui.effects) effect();
    if (!ui.dirty) return markup;
  }
  throw new Error('Render did not settle');
}

function setup(initialNote = '', onSave = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const render = () => {
    ui.cursor = 0;
    ui.input = undefined;
    renderTree(<ReaderNoteEditorDrawer portalHostName="editor" confirmationHostName="confirm" isOpen initialNote={initialNote} onClose={onClose} onSave={onSave} />);
  };
  render();
  return { render, onClose, onSave };
}

describe('reader note editor interactions', () => {
  it('commits toolbar text and selection together through controlled props', () => {
    const app = setup('斜体');
    ui.input!.onSelectionChange!({ nativeEvent: { selection: { start: 0, end: 2 } } });
    app.render();
    expect(ui.input!.selection).toEqual({ start: 0, end: 2 });
    const formatted = ui.input!.formatSelection!('斜体', 0, 2, 'formatItalic');
    expect(formatted.updatedText).toBe('_斜体_');
    expect(ui.input!.value).toBe('斜体');
    ui.buttons.get('markdown.italic')!.onPress();
    app.render();
    expect(ui.input!.value).toBe('_斜体_');
    expect(ui.input!.selection).toEqual({ start: 1, end: 3 });
    expect(ui.nativeInput.setSelection).not.toHaveBeenCalled();
    expect(ui.nativeInput.focus).toHaveBeenCalledOnce();
    ui.buttons.get('markdown.italic')!.onPress(); app.render();
    expect(ui.input!.value).toBe('斜体');
    expect(ui.input!.selection).toEqual({ start: 0, end: 2 });
  });
  it.each(['text-first', 'selection-first'])('uses the reported caret after deleting a format marker: %s', (order) => {
    const app = setup('_斜体_');
    ui.input!.onSelectionChange!({ nativeEvent: { selection: { start: 4, end: 4 } } }); app.render();
    const textChanged = () => ui.input!.onChangeText('_斜体');
    const selectionChanged = () => ui.input!.onSelectionChange!({ nativeEvent: { selection: { start: 3, end: 3 } } });
    if (order === 'text-first') { textChanged(); app.render(); selectionChanged(); }
    else { selectionChanged(); app.render(); textChanged(); }
    app.render();
    expect(ui.input!.value).toBe('_斜体');
    expect(ui.input!.selection).toEqual({ start: 3, end: 3 });
    expect(ui.nativeInput.setSelection).not.toHaveBeenCalled();
  });
  it('can use the shared editor outside a sheet with caller-owned input props', () => {
    const onChangeText = vi.fn();
    const onFocus = vi.fn();
    renderTree(<MarkdownEditor value="## 草稿" maxLength={500} placeholder="输入内容"
      onChangeText={onChangeText} onFocus={onFocus} />);
    expect(ui.openStates).toEqual([]);
    expect(ui.input).toMatchObject({ value: '## 草稿', maxLength: 500, placeholder: '输入内容' });
    ui.input!.onChangeText('修改内容');
    ui.input!.onFocus!();
    expect(onChangeText).toHaveBeenCalledWith('修改内容');
    expect(onFocus).toHaveBeenCalledOnce();
  });
  it('retains the draft after a save failure and allows retrying', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const app = setup('', onSave);
    ui.input!.onChangeText('**我的笔记**'); app.render();
    ui.buttons.get('reader.noteSave')!.onPress();
    await vi.waitFor(() => expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    app.render();
    expect(ui.input!.value).toBe('**我的笔记**');
    expect(app.onClose).not.toHaveBeenCalled();
    ui.buttons.get('reader.noteSave')!.onPress();
    await vi.waitFor(() => expect(app.onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenLastCalledWith('**我的笔记**');
  });
  it('requires confirmation before discarding an edited draft', () => {
    const app = setup();
    ui.input!.onChangeText('draft'); app.render();
    ui.buttons.get('action.cancel')!.onPress(); app.render();
    expect(ui.confirm!.isOpen).toBe(true);
    expect(app.onClose).not.toHaveBeenCalled();
    ui.confirm!.onOpenChange(false); app.render();
    expect(ui.input!.value).toBe('draft');
    ui.buttons.get('action.cancel')!.onPress(); app.render();
    ui.confirm!.onConfirm();
    expect(app.onClose).toHaveBeenCalledOnce();
    expect(app.onSave).not.toHaveBeenCalled();
  });
  it('loads the selected note for editing', async () => {
    const app = setup('# Saved');
    expect(ui.input!.value).toBe('# Saved');
    ui.input!.onChangeText('# Edited'); app.render();
    ui.buttons.get('reader.noteSave')!.onPress();
    await vi.waitFor(() => expect(app.onClose).toHaveBeenCalledOnce());
    expect(app.onSave).toHaveBeenCalledWith('# Edited');
  });
  it('submits once and prevents closing while the save is pending', async () => {
    let finish!: () => void;
    const app = setup('', vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    ui.input!.onChangeText('draft'); app.render();
    const save = ui.buttons.get('reader.noteSave')!.onPress;
    save(); save();
    ui.buttons.get('action.cancel')!.onPress();
    expect(app.onSave).toHaveBeenCalledOnce();
    expect(app.onClose).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(app.onClose).toHaveBeenCalledOnce());
  });
});

describe('reader notes viewing overlay', () => {
  function setupViewer(notes: readonly ReaderNote[] = []) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const render = () => {
      ui.cursor = 0; ui.input = undefined;
      return renderTree(<ReaderNotesOverlay quote="引用原文" notes={notes} blurTarget={{ current: null }}
        onSave={onSave} onRemove={onRemove} onClose={onClose} />);
    };
    return { render, onSave, onRemove, onClose };
  }

  const notes = [
    { id: 'first', content: '**第一条**', createdAt: 1, updatedAt: 1 },
    { id: 'second', content: '*第二条*', createdAt: 2, updatedAt: 2 },
  ];

  it('offers expansion only for quotes that lay out beyond two lines', () => {
    const app = setupViewer(notes);
    expect(app.render()).not.toContain('reader.noteExpandQuote');
    expect(ui.quoteLines).toBe(2);
    ui.measureQuote!({ nativeEvent: { lines: [{}, {}] } });
    expect(app.render()).not.toContain('reader.noteExpandQuote');
    ui.measureQuote!({ nativeEvent: { lines: [{}, {}, {}] } });
    expect(app.render()).toContain('reader.noteExpandQuote');
    ui.buttons.get('reader.noteExpandQuote')!.onPress();
    expect(app.render()).toContain('reader.noteCollapseQuote');
    expect(ui.quoteLines).toBeUndefined();
    ui.buttons.get('reader.noteCollapseQuote')!.onPress(); app.render();
    expect(ui.quoteLines).toBe(2);
    // A wider layout can fit the quote again without retaining the expand action.
    ui.measureQuote!({ nativeEvent: { lines: [{}] } });
    expect(app.render()).not.toContain('reader.noteExpandQuote');
  });

  it('shows the quote and independent notes before mounting an editor', () => {
    const app = setupViewer(notes);
    const markup = app.render();
    expect(markup).toContain('引用原文');
    expect(markup).toContain('**第一条**');
    expect(markup).toContain('*第二条*');
    expect(ui.input).toBeUndefined();
    expect(ui.openStates.at(-1)).toBe(false);
    expect(ui.notePortal).toMatch(/:notes$/);
  });
  it('opens an empty drawer only after Add note and keeps the viewer open after saving', async () => {
    const app = setupViewer();
    expect(app.render()).toContain('reader.noteNone');
    ui.buttons.get('reader.noteAdd')!.onPress(); app.render();
    expect(ui.input!.value).toBe('');
    expect(ui.openStates[0]).toBe(false);
    expect(ui.openStates.at(-1)).toBe(true);
    expect(ui.hosts).toContain(ui.portal);
    ui.input!.onChangeText('新笔记'); app.render();
    ui.buttons.get('reader.noteSave')!.onPress();
    await vi.waitFor(() => expect(app.onSave).toHaveBeenCalledWith('新笔记', undefined));
    expect(app.onClose).not.toHaveBeenCalled();
  });
  it('edits and deletes a note by ID, leaving other note cards in the viewer', async () => {
    const app = setupViewer(notes); app.render();
    ui.buttons.get('reader.noteEdit')!.onPress(); app.render();
    expect(ui.input!.value).toBe('*第二条*');
    ui.input!.onChangeText('修改第二条'); app.render();
    ui.buttons.get('reader.noteSave')!.onPress();
    await vi.waitFor(() => expect(app.onSave).toHaveBeenCalledWith('修改第二条', 'second'));
    app.render();
    ui.buttons.get('reader.noteDelete')!.onPress(); app.render();
    expect(ui.confirm!.isOpen).toBe(true);
    ui.confirm!.onConfirm();
    await vi.waitFor(() => expect(app.onRemove).toHaveBeenCalledWith('second'));
    expect(app.onClose).not.toHaveBeenCalled();
  });
});
