/**
 * Tauri-specific ambient type extensions.
 *
 * In the Tauri webview, File objects delivered by the OS (drag-drop,
 * file picker) carry a non-standard `path` property with the absolute
 * native path. Declared here once so call-sites don't need `as any`.
 */
declare global {
  interface File {
    /** Absolute native path — present only inside the Tauri desktop shell. */
    readonly path?: string;
  }
}

export {};
