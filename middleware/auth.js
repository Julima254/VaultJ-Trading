module.exports.isAdmin = (req, res, next) => {
  // User must be logged in
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/login'); // or res.status(401).send('Login required');
  }

  // User must be admin
  if (!req.user.isAdmin) {
    return res.status(403).send('Access denied');
  }

  next();
};
