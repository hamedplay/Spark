// Retain explicit visibility choices, remove deleted options, enable new options.
export function mergeLiveSelection(current: ReadonlySet<string>, previousOptions: ReadonlySet<string> | null, nextOptions: ReadonlySet<string>) {
  if (!previousOptions) return new Set(nextOptions);
  return new Set([...nextOptions].filter(id => current.has(id) || !previousOptions.has(id)));
}
