import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
const envFile = fs.readFileSync(path.resolve('./.env'), 'utf8');
const env = Object.fromEntries(envFile.split(/\r?\n/).filter(Boolean).map(line => {
  const [k, ...rest] = line.split('=');
  return [k, rest.join('=').replace(/^"|"$/g, '')];
}));
const uri = env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI missing');
  process.exit(1);
}
console.log('Using URI:', uri.slice(0, 40) + '...');
await mongoose.connect(uri).catch(err => { console.error('connect error', err.message || err); process.exit(1); });
const userSchema = new mongoose.Schema({ email: String, passwordHash: String, name: String, organizationName: String, role: String }, { collection: 'users' });
const User = mongoose.model('User', userSchema, 'users');
const users = await User.find({}).lean().limit(20);
console.log('count', users.length);
for (const u of users) {
  console.log({ email: u.email, name: u.name, org: u.organizationName, role: u.role, hasPassword: !!u.passwordHash });
}
await mongoose.disconnect();
