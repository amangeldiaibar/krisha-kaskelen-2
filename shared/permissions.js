/**
 * What an admin may do. The owner may do everything and is the only one who
 * makes other admins. An admin whose permissions are null may do everything
 * too: that is how admins made before permissions existed keep their rights.
 */
export const PERMISSIONS = ['listings', 'duplicates', 'reports', 'reviews', 'users', 'log'];

export const isOwner = (user) => user?.role === 'owner';
export const isAdmin = (user) => user?.role === 'admin' || isOwner(user);

export function can(user, permission) {
  if (isOwner(user)) return true;
  if (user?.role !== 'admin') return false;
  return user.permissions === null || user.permissions === undefined || user.permissions.includes(permission);
}
