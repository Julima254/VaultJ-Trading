// middleware/requireAdmin.js
module.exports = function requireAdmin(req, res, next) {
  // Not logged in at all
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  // res.locals.user is already loaded in app.js middleware
  if (!res.locals.user || !res.locals.user.isAdmin) {
    return res.status(403).render("403", {
      currentPage: "",
    });
  }

  next();
};