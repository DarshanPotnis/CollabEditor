/**
 * monaco-editor ships types only for its public API, but its exports map
 * still serves the modules underneath. The URI module is the same class the
 * public API exports as `monaco.Uri`, and importing it directly is what lets
 * the URI logic be unit-tested in Node without loading the editor.
 */
declare module 'monaco-editor/base/common/uri' {
  export { Uri as URI } from 'monaco-editor';
}
