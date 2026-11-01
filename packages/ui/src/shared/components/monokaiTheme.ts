import type { BeforeMount } from "@monaco-editor/react";

export const MONOKAI_THEME = "cognition-monokai";

/** Monaco uses its own token names rather than VS Code's TextMate scopes. */
export const registerMonokaiTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(MONOKAI_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "f8f8f2", background: "272822" },
      { token: "comment", foreground: "88846f" },
      { token: "string", foreground: "e6db74" },
      { token: "string.escape", foreground: "ae81ff" },
      { token: "number", foreground: "ae81ff" },
      { token: "constant", foreground: "ae81ff" },
      { token: "keyword", foreground: "f92672" },
      { token: "operator", foreground: "f92672" },
      { token: "type", foreground: "66d9ef" },
      { token: "type.identifier", foreground: "a6e22e" },
      { token: "identifier", foreground: "f8f8f2" },
      { token: "function", foreground: "a6e22e" },
      { token: "delimiter", foreground: "f8f8f2" },
      { token: "tag", foreground: "f92672" },
      { token: "attribute.name", foreground: "a6e22e" },
      { token: "attribute.value", foreground: "e6db74" },
      { token: "regexp", foreground: "e6db74" },
    ],
    colors: {
      "editor.background": "#272822",
      "editor.foreground": "#f8f8f2",
      "editor.lineHighlightBackground": "#3e3d32",
      "editor.selectionBackground": "#878b9180",
      "editor.inactiveSelectionBackground": "#414339",
      "editorCursor.foreground": "#f8f8f0",
      "editorLineNumber.foreground": "#90908a",
      "editorLineNumber.activeForeground": "#c2c2bf",
      "editorWhitespace.foreground": "#464741",
      "editorIndentGuide.background1": "#464741",
      "editorIndentGuide.activeBackground1": "#767771",
      "editorGutter.background": "#272822",
      "editorWidget.background": "#1e1f1c",
      "editorWidget.border": "#75715e",
      "editorSuggestWidget.background": "#272822",
      "editorSuggestWidget.border": "#75715e",
      "editorHoverWidget.background": "#414339",
      "editorHoverWidget.border": "#75715e",
      "editor.findMatchBackground": "#75715e",
      "diffEditor.insertedTextBackground": "#4b661680",
      "diffEditor.removedTextBackground": "#90274a70",
    },
  });
};
