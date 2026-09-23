import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Prec } from '@codemirror/state';
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
    // Prec.highest so these colors win over oneDark's own background rules.
    Prec.highest(EditorView.theme({
      '&': { height: '100%', fontSize: '14px', backgroundColor: '#12131f' },
      '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.75', overflow: 'auto', fontFeatureSettings: '"liga" 0, "calt" 0' },
      '.cm-content': { padding: '18px 0', caretColor: '#a5b4fc' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#a5b4fc', borderLeftWidth: '2px' },
      '.cm-line': { padding: '0 20px 0 12px' },
      '.cm-gutters': { backgroundColor: '#12131f', color: '#8083a8', border: 'none' },
      '.cm-gutterElement': { paddingLeft: '16px' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#1b1d2e' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#35397a' },
      '&.cm-focused': { outline: 'none' },
    }, { dark: true })),
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
