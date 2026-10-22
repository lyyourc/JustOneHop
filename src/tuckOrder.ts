/** Keep known tab positions; place newly seen tabs beside their next known neighbour. */
export function mergeTuckOrder(previous: number[], current: number[]): number[] {
  const live = new Set(current);
  const order = previous.filter(id => live.has(id));
  const known = new Set(order);
  let pending: number[] = [];
  for (const id of current) {
    if (!known.has(id)) { pending.push(id); continue; }
    if (pending.length) {
      order.splice(order.indexOf(id), 0, ...pending);
      pending = [];
    }
  }
  return [...order, ...pending];
}

/** A user's reorder of existing group members supersedes the old reference order. */
export function tuckOrderForBatch(previous: number[] | undefined, current: number[], members: number[]): number[] {
  if (!previous) return current;
  const memberIds = new Set(members);
  const expected = previous.filter(id => memberIds.has(id));
  if (expected.length !== members.length || expected.some((id, index) => id !== members[index])) return current;
  return mergeTuckOrder(previous, current);
}
