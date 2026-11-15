import { Firestore } from '@google-cloud/firestore';

export function createFirestoreStore({ credentials, projectId, collection = 'circles' }) {
  const db = new Firestore({
    projectId: projectId ?? credentials?.project_id,
    ...(credentials ? { credentials } : {}),
    ignoreUndefinedProperties: true,
  });
  const circles = db.collection(collection);

  return {
    kind: 'firestore',
    async get(id) {
      const snapshot = await circles.doc(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async create(circle) {
      try {
        await circles.doc(circle.id).create(circle);
        return true;
      } catch (error) {
        if (error.code === 6) return false;
        throw error;
      }
    },
    async update(id, mutate) {
      return db.runTransaction(async (tx) => {
        const ref = circles.doc(id);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const draft = snapshot.data();
        const result = await mutate(draft);
        tx.set(ref, draft);
        return { circle: draft, result };
      });
    },
    async ids() {
      const refs = await circles.listDocuments();
      return refs.map((ref) => ref.id);
    },
  };
}
