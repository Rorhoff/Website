(function () {
  const btn   = document.getElementById("navHamburger");
  const links = document.getElementById("navLinks");
  if (!btn || !links) return;

  btn.addEventListener("click", function () {
    const open = links.classList.toggle("open");
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
