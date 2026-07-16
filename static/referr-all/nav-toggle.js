// Portfolio cross-link nav hamburger (rorhoff.com dev only; nav is hidden on
// referr-all.com prod). External file so the strict CSP (script-src 'self')
// doesn't block it as an inline script.
(function () {
  var btn = document.getElementById("navHamburger");
  var links = document.getElementById("navLinks");
  if (!btn || !links) return;
  btn.addEventListener("click", function () {
    var open = links.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
    btn.textContent = open ? "✕" : "☰";
  });
  document.addEventListener("click", function (e) {
    if (!links.contains(e.target) && e.target !== btn) {
      links.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "☰";
    }
  });
})();
