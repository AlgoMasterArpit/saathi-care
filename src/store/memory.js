export function createMemoryStore() {
  const circles = new Map();
  let queue = Promise.resolve();

  const serialize = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  return {
    kind: 'memory',
    async get(id) {
      const circle = circles.get(id);
      return circle ? structuredClone(circle) : null;
    },
    async create(circle) {
      return serialize(() => {
        if (circles.has(circle.id)) return false;
        circles.set(circle.id, structuredClone(circle));
        return true;
      });
    },
    async update(id, mutate) {
      return serialize(async () => {
        const current = circles.get(id);
        if (!current) return null;
        const draft = structuredClone(current);
        const result = await mutate(draft);
        circles.set(id, draft);
        return { circle: structuredClone(draft), result };
      });
    },
    async ids() {
      return [...circles.keys()];
    },
  };
}
