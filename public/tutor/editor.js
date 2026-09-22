import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

const languageExtensions = { python, javascript };
export function createCodeEditor({ parent, language = 'python', doc = '', nonce = '', onChange, onSelection = () => {} }) {
  const languageSlot = new Compartment();
  const editSlot = new Compartment();
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [
    basicSetup, oneDark, languageSlot.of(languageExtensions[language]()),
    editSlot.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
    indentUnit.of('    '), EditorState.tabSize.of(4), keymap.of([indentWithTab]),
    EditorView.cspNonce.of(nonce),
    EditorView.contentAttributes.of({ 'aria-label': 'Solution code editor', 'aria-describedby': 'editor-help', spellcheck: 'false' }),
    EditorView.theme({
      '&': { height: '100%', fontSize: '14px', backgroundColor: '#151a18' },
      '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.75', overflow: 'auto' },
      '.cm-content': { padding: '18px 0', caretColor: '#d5f890' },
      '.cm-line': { padding: '0 20px 0 12px' },
      '.cm-gutters': { backgroundColor: '#151a18', color: '#68756d', border: 'none' },
      '.cm-gutterElement': { paddingLeft: '16px' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#202721' },
      '&.cm-focused': { outline: 'none' },
    }),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        const changes = [];
        update.changes.iterChanges((from,to,_fromB,_toB,insert) => changes.push({ from,to,insert:insert.toString() }));
        onChange(update.state.doc.toString(), changes.length <= 200 ? changes : [{ from:0,to:update.startState.doc.length,insert:update.state.doc.toString() }]);
      }
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head, line = update.state.doc.lineAt(pos);
        onSelection({ line:line.number, column:pos-line.from+1 });
      }
    }),
  ] }) });
  return {
    view,
    setLanguage(next) { view.dispatch({ effects: languageSlot.reconfigure(languageExtensions[next]()) }); },
    setEditable(enabled) { view.dispatch({ effects: editSlot.reconfigure([EditorState.readOnly.of(!enabled), EditorView.editable.of(enabled)]) }); },
    code: () => view.state.doc.toString(),
  };
}
