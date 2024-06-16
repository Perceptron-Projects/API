const rolesMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    const userRoles = Array.isArray(req.user.role) ? req.user.role : [req.user.role];

    if (userRoles.some(userRole => allowedRoles.includes(userRole))) {
      next();
    } else {
      res.status(403).json({ error: "Access denied. Insufficient permissions." });
    }
  };
};

module.exports = { rolesMiddleware };
