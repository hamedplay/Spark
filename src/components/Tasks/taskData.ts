import type { ActionTask } from './TaskCard';

/** Read every accessible page; never silently treat the API's first page as the total. */
export async function loadAllTaskPages(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: ActionTask[] | null; error: unknown; count?: number | null }>,
  pageSize = 500,
): Promise<ActionTask[]> {
  const tasks = new Map<string, ActionTask>();
  let total: number | null = null;
  for (let from = 0; ;) {
    const { data, error, count } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (typeof count === 'number') total = count;
    for (const task of data || []) tasks.set(task.id, task);
    if (!data?.length) return [...tasks.values()];
    from += data.length;
    if (total !== null && from >= total) return [...tasks.values()];
  }
}
