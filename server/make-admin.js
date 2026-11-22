import { openDatabase } from './open-db.js';
import { normalizePhone } from '../shared/phones.js';

// npm run admin -- you@example.com        gives admin rights
// npm run admin -- +77001234567 --remove  takes them away
const args = process.argv.slice(2);
const login = args.find((arg) => !arg.startsWith('--'));
const remove = args.includes('--remove');
if (!login) {
  console.error('Usage: npm run admin -- <email or phone> [--remove]');
  process.exit(1);
}

const db = await openDatabase();
const user = await db.get('SELECT id, name, email FROM users WHERE lower(email) = lower($1) OR phone = $2', [login, normalizePhone(login) ?? login]);
if (!user) {
  console.error(`No account with the email or phone ${login}. Register on the site first.`);
  await db.close();
  process.exit(1);
}
// Admins made here get every section of the panel.
await db.run('UPDATE users SET role = $1, admin_scopes = NULL WHERE id = $2', [remove ? 'user' : 'admin', user.id]);
console.log(`${user.name} (${user.email}) is ${remove ? 'no longer an admin' : 'now an admin'}. The admin panel is at /ru/admin.`);
await db.close();
