// Runs before first paint so the stored theme applies without a flash of the
// wrong palette. Kept as an external file rather than inline because the
// backend's Content-Security-Policy is script-src 'self'.
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("ferrous-theme") === "light") theme = "light";
  } catch (_) {}
  document.documentElement.setAttribute("data-theme", theme);
})();
