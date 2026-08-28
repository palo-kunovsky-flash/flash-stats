/**
 * Copy to the clipboard from a webview.
 *
 * `navigator.clipboard` needs a secure context, which `tauri://localhost` is
 * not always treated as, so the old textarea trick stays as the fallback. Both
 * are tried before a copy is reported as failed.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    /* not a secure context — fall through */
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}
