import { openDatabase } from './open-db.js';
import { normalizePhone } from '../shared/phones.js';

// npm run admin -- you@example.com          gives full admin rights
// npm run admin -- you@example.com --owner  makes the owner, who also makes other admins on the site
// npm run admin -- +77001234567 --remove    takes the rights away
const args = process.argv.slice(2);
const login = args.find((arg) => !arg.startsWith('--'));
const remove = args.includes('--remove');
const owner = args.includes('--owner');
if (!login) {
  console.error('Usage: npm run admin -- <email or phone> [--owner | --remove]');
  process.exit(1);
}

const db = await openDatabase();
const user = await db.get('SELECT id, name, email FROM users WHERE lower(email) = lower($1) OR phone = $2', [login, normalizePhone(login) ?? login]);
if (!user) {
  console.error(`No account with the email or phone ${login}. Register on the site first.`);
  await db.close();
  process.exit(1);
}
const role = remove ? 'user' : owner ? 'owner' : 'admin';
// NULL permissions: a full admin.
await db.run('UPDATE users SET role = $1, permissions = NULL WHERE id = $2', [role, user.id]);
const said = { user: 'no longer an admin', admin: 'now an admin with every permission', owner: 'now the owner and can make other admins in the admin panel' };
console.log(`${user.name} (${user.email}) is ${said[role]}. The admin panel is at /ru/admin.`);
await db.close();
