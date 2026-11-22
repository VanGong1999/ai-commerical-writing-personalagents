export function hookReviewSelection<T extends {id: string}>(rows: T[], selected: ReadonlySet<string>) {
  const requiresSelection = rows.length > 100;
  const reviewRows = requiresSelection ? rows.filter(row => selected.has(row.id)) : rows;
  return { requiresSelection, reviewRows, reviewRangeValid: reviewRows.length >= 1 && reviewRows.length <= 100 };
}
