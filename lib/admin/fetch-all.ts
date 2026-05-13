import "server-only";

type SupabaseRangeQuery<T> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
};

const DEFAULT_FETCH_ALL_PAGE_SIZE = 1000;

export async function fetchAllSupabaseRows<T>(
  buildQuery: () => SupabaseRangeQuery<T>,
  pageSize = DEFAULT_FETCH_ALL_PAGE_SIZE,
): Promise<T[]> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery().range(from, from + safePageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < safePageSize) {
      return rows;
    }

    from += safePageSize;
  }
}
