/**
 * Whether `path` has a `..` anywhere but at its start. A path input may climb
 * out of the directory it is relative to, but a `..` after a name would make
 * the path's spelling and the kernel's walk through a symlink disagree.
 */
export function hasDotDotAfterStart(path: string): boolean {
  const parts = path.split("/");
  let start = 0;
  while (parts[start] === ".." || parts[start] === ".") start++;
  return parts.slice(start).includes("..");
}
