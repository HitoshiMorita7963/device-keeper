export const PAGE_SIZE = 50;

export type PageQuery = { page?: string };

export function currentPage(query: PageQuery): number {
  const n = Number(query.page);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function pageArgs(query: PageQuery, size = PAGE_SIZE) {
  return { skip: (currentPage(query) - 1) * size, take: size };
}

/** searchParams から文字列のみを取り出す (配列・未指定は除外) */
export function pickParams<K extends string>(
  params: Record<string, string | string[] | undefined>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}
