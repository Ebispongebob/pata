import { Clipboard } from '@wailsio/runtime';

/**
 * Safely copies text to the system clipboard across desktop (Wails native NSPasteboard)
 * and browser environments (navigator.clipboard / document.execCommand).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Primary: Wails desktop native clipboard (bypasses WKWebView permissions)
  try {
    if (Clipboard && typeof Clipboard.SetText === 'function') {
      await Clipboard.SetText(text);
      return true;
    }
  } catch (err) {
    console.warn('Wails Clipboard.SetText failed, falling back:', err);
  }

  // 2. Secondary: standard browser clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('navigator.clipboard.writeText failed, falling back:', err);
  }

  // 3. Fallback: legacy DOM execCommand
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) return true;
    }
  } catch (err) {
    console.error('All clipboard copy mechanisms failed:', err);
  }

  return false;
}
