require('dotenv').config();
const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  let token = req.header("Authorization");

  if (!token) return res.status(401).json({ error: "Access denied. Token is missing." });
   token = token.startsWith("Bearer ") ? token.slice(7) : token;

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    
    if (err) return res.status(403).json({ error: "Invalid token." });

    req.user = user;
    next();
  });
};

module.exports = { authenticateToken };
