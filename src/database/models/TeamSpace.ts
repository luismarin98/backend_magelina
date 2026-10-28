import mongoose from 'mongoose';
const channelSchema = new mongoose.Schema({key:String,name:String,type:String,channelId:String,status:String}, {_id:false});
const schema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, immutable: true },
  roleIds: { type: [String], default: [] }, categoryId: { type: String, default: null },
  channels: { type: [channelSchema], default: [] },
  locked: { type: Boolean, default: false }, version: { type: Number, default: 0 },
  summaryPending: { type: Boolean, default: false },
  summaryMessageId: { type: String, default: null },
}, { timestamps: true });
export const TeamSpace = mongoose.model('TeamSpace', schema);
