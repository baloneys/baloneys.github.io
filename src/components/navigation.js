import React from 'react'

import Script from 'dangerous-html/react'

import './navigation.css'

const Navigation = (props) => {
  return (
    <div className="navigation-container1">
      <div className="navigation-container2">
        <div className="navigation-container3">
          <Script
            html={`<style>
@media (prefers-reduced-motion: reduce) {
.navigation-mobile-overlay.is-open {
  animation: none;
}
.navigation-mobile-link:hover {
  transform: none;
}
}
</style>`}
          ></Script>
        </div>
      </div>
      <nav className="navigation-wrapper">
        <div className="navigation-container">
          <a href="/">
            <div className="navigation-logo">
              <span className="section-title">baloneys</span>
            </div>
          </a>
          <div className="navigation-desktop-menu">
            <a
              href="https://vrchat.com/home/user/usr_54097a4a-dab6-47ce-bcc5-00f39aa03555"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="navigation-link">
                <span>Worlds</span>
              </div>
            </a>
            <a
              href="https://kanaris-beans.com/dynabackend/vrc-dynamic-player-tags.html"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="navigation-link">
                <span>Tagging</span>
              </div>
            </a>
            <a
              href="https://kanaris-beans.com/speen"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="navigation-link">
                <span>speen</span>
              </div>
            </a>
            <a
              href="https://jinxxy.com/baloneys"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="navigation-link">
                <span>Store</span>
              </div>
            </a>
            <a
              href="https://discord.gg/gYWJsYhwXN"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div className="btn-sm btn-primary btn">
                <span>Contact Me</span>
              </div>
            </a>
          </div>
          <button
            id="navToggle"
            aria-label="Open Menu"
            aria-expanded="false"
            className="navigation-toggle"
          >
            <svg
              width="24"
              xmlns="http://www.w3.org/2000/svg"
              height="24"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 6h16M4 12h16M4 18h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
            </svg>
          </button>
        </div>
      </nav>
      <div id="mobileOverlay" className="navigation-mobile-overlay">
        <div className="navigation-mobile-header">
          <a href="/">
            <div className="navigation-logo">
              <span className="section-title">baloneys</span>
            </div>
          </a>
          <button
            id="navClose"
            aria-label="Close Menu"
            className="navigation-toggle"
          >
            <svg
              width="24"
              xmlns="http://www.w3.org/2000/svg"
              height="24"
              viewBox="0 0 24 24"
            >
              <path
                d="M18 6L6 18M6 6l12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
            </svg>
          </button>
        </div>
        <div className="navigation-mobile-content">
          <div className="navigation-mobile-links">
            <a href="/">
              <div className="navigation-mobile-link">
                <span>Worlds</span>
              </div>
            </a>
            <a href="/">
              <div className="navigation-mobile-link">
                <span>Avatars</span>
              </div>
            </a>
            <a href="/">
              <div className="navigation-mobile-link">
                <span>Assets</span>
              </div>
            </a>
            <a href="/">
              <div className="navigation-mobile-link">
                <span>Store</span>
              </div>
            </a>
          </div>
          <div className="navigation-mobile-actions">
            <a href="/">
              <div className="btn-primary btn-lg btn">
                <span>Get in Touch</span>
              </div>
            </a>
          </div>
        </div>
      </div>
      <div className="navigation-container4">
        <div className="navigation-container5">
          <Script
            html={`<style>
        @keyframes fadeIn {from {opacity: 0;}
to {opacity: 1;}}
        </style> `}
          ></Script>
        </div>
      </div>
      <div className="navigation-container6">
        <div className="navigation-container7">
          <Script
            html={`<script defer data-name="navigation-logic">
(function(){
  const navToggle = document.getElementById("navToggle")
  const navClose = document.getElementById("navClose")
  const mobileOverlay = document.getElementById("mobileOverlay")
  const body = document.body

  function openMenu() {
    mobileOverlay.classList.add("is-open")
    navToggle.setAttribute("aria-expanded", "true")
    body.style.overflow = "hidden"
  }

  function closeMenu() {
    mobileOverlay.classList.remove("is-open")
    navToggle.setAttribute("aria-expanded", "false")
    body.style.overflow = ""
  }

  navToggle.addEventListener("click", openMenu)
  navClose.addEventListener("click", closeMenu)

  const mobileLinks = mobileOverlay.querySelectorAll(".navigation-mobile-link")
  mobileLinks.forEach((link) => {
    link.addEventListener("click", closeMenu)
  })

  window.addEventListener("resize", () => {
    if (window.innerWidth > 767 && mobileOverlay.classList.contains("is-open")) {
      closeMenu()
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileOverlay.classList.contains("is-open")) {
      closeMenu()
    }
  })
})()
</script>`}
          ></Script>
        </div>
      </div>
    </div>
  )
}

export default Navigation
