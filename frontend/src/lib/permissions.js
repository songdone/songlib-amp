

export const userIsAdmin = (user) => ["admin", "owner"].includes(user?.role);
