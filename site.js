// site.js — shared behaviour for pages built on the homepage shell
// (mobile menu, nav shadow, footer year, scroll reveal, broken-image cleanup).
(function () {
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear()
  })

  var nav = document.getElementById("siteNav")
  if (nav) {
    var onScroll = function () { nav.classList.toggle("is-scrolled", window.scrollY > 8) }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
  }

  var navToggle = document.getElementById("navToggle")
  var navClose = document.getElementById("navClose")
  var overlay = document.getElementById("mobileOverlay")
  if (navToggle && navClose && overlay) {
    var openMenu = function () {
      overlay.classList.add("is-open")
      navToggle.setAttribute("aria-expanded", "true")
      document.body.style.overflow = "hidden"
      navClose.focus()
    }
    var closeMenu = function () {
      overlay.classList.remove("is-open")
      navToggle.setAttribute("aria-expanded", "false")
      document.body.style.overflow = ""
    }
    navToggle.addEventListener("click", openMenu)
    navClose.addEventListener("click", closeMenu)
    overlay.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu) })
    window.addEventListener("resize", function () {
      if (window.innerWidth > 767 && overlay.classList.contains("is-open")) closeMenu()
    })
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("is-open")) { closeMenu(); navToggle.focus() }
    })
  }

  document.querySelectorAll("img[data-hide-broken]").forEach(function (img) {
    var hide = function () { img.style.visibility = "hidden" }
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) hide()
    img.addEventListener("error", hide)
  })

  var reveals = document.querySelectorAll(".reveal")
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target) }
      })
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" })
    reveals.forEach(function (el) { io.observe(el) })
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible") })
  }
})()
