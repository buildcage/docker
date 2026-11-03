/**
 * Whether `path` has a `..` anywhere but at its start. A path input may climb
 * out of the directory it is relative to, but a `..` after a name would make
 * the path's spelling and the kernel's walk through a symlink disagree.
 */
export function hasDotDotAfterStart(path: string): boolean {
  const parts = path.split("/");
  let start = 0;
  // An empty first part is the root of an absolute path, which cannot climb.
  while (["..", "."].includes(parts[start]!) || (start > 0 && parts[start] === "")) start++;
  return parts.slice(start).includes("..");
}

/** The reason a path input gives when hasDotDotAfterStart refuses it. */
export const DOT_DOT_AFTER_START =
  'has a ".." after its start. Name the path without it; only a relative path may climb, ' +
  'with a leading "../".';
