// Shared, pure helpers used by more than one user-domain controller
// (profile CRUD + account deletion). Extracted verbatim from userController.js
// as part of the userController split (teamController pattern).

const buildUserDisplayName = (user) => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.username;
};

const toIsoString = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
};

module.exports = {
  buildUserDisplayName,
  toIsoString,
};
