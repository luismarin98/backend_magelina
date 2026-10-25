import mongoose from 'mongoose';
export interface ProjectRecord { guildId: string; title: string; description: string; objectives: string[]; completedObjectives: number[]; dueAt: Date | null; archived: boolean; version: number; history: { actorId: string; action: string; at: Date }[] }
const schema = new mongoose.Schema<ProjectRecord>({
  guildId: { type: String, required: true, immutable: true }, title: { type: String, required: true, maxlength: 160 }, description: { type: String, maxlength: 4000, default: '' },
  objectives: { type: [String], default: [] }, completedObjectives: { type: [Number], default: [] }, dueAt: { type: Date, default: null },
  archived: { type: Boolean, default: false }, version: { type: Number, default: 0 },
  history: { type: [new mongoose.Schema({ actorId: String, action: String, at: Date }, { _id: false })], default: [] },
});
schema.index({ guildId: 1, _id: -1 }); schema.index({ archived: 1, dueAt: 1 });
export const Project = mongoose.model('Project', schema);
