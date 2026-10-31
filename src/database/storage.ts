import mongoose from 'mongoose';

/** Storage allocated to this database, including indexes (bytes). */
export async function getDatabaseStorage() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;
  try {
    const stats = await mongoose.connection.db.command({ dbStats: 1, scale: 1, maxTimeMS: 3000 });
    const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (!valid(stats.storageSize) || !valid(stats.indexSize)) return null;
    return {
      totalBytes: stats.storageSize + stats.indexSize,
      dataBytes: stats.storageSize,
      indexBytes: stats.indexSize,
    };
  } catch {
    // Missing dbStats permissions must not hide the rest of the control center.
    return null;
  }
}
