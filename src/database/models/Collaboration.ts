import mongoose from 'mongoose';
export interface ProfileRecord { guildId: string; userId: string; bio: string; offers: string[]; seeks: string[]; available: boolean; version: number }
const profile = new mongoose.Schema<ProfileRecord>({ guildId: { type: String, required: true }, userId: { type: String, required: true }, bio: String,
  offers: [String], seeks: [String], available: Boolean, version: { type: Number, default: 0 } });
profile.index({ guildId: 1, userId: 1 }, { unique: true }); profile.index({ guildId: 1, _id: -1 });
export const CollaborationProfile = mongoose.model('CollaborationProfile', profile);
export interface MentorshipRecord { guildId: string; mentorId: string; learnerId: string; goal: string; status: 'pending' | 'active' | 'completed' | 'cancelled'; acceptedBy: string[]; version: number; history: { actorId: string; action: string; at: Date }[] }
const mentorship = new mongoose.Schema<MentorshipRecord>({ guildId: { type: String, required: true }, mentorId: String, learnerId: String, goal: String,
  status: { type: String, enum: ['pending', 'active', 'completed', 'cancelled'], default: 'pending' }, acceptedBy: { type: [String], default: [] }, version: { type: Number, default: 0 },
  history: { type: [new mongoose.Schema({ actorId: String, action: String, at: Date }, { _id: false })], default: [] } });
mentorship.index({ guildId: 1, _id: -1 });
export const Mentorship = mongoose.model('Mentorship', mentorship);
