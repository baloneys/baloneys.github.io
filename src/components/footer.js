import React from 'react'

import Script from 'dangerous-html/react'

import './footer.css'

const Footer = (props) => {
  return (
    <div className="footer-container1">
      <footer className="footer-root">
        <div className="footer-container">
          <div className="footer-grid">
            <div className="footer-brand-column">
              <a href="/">
                <div className="footer-logo-link">
                  <span className="footer-logo-text">baloneys</span>
                </div>
              </a>
              <p className="footer-brand-description section-content">
                <span>Crafting highly immersive experiences,</span>
                <br></br>
                <span>environments, and robust prefabs.</span>
                <br></br>
              </p>
              <div className="footer-social-links">
                <a
                  href="https://discord.gg/gYWJsYhwXN"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div
                    aria-label="Discord"
                    className="footer-thq-footer-social-icon-elm1 footer-social-icon"
                  >
                    <svg
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                      height="24"
                      viewBox="0 0 24 24"
                    >
                      <g
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M8 12a1 1 0 1 0 2 0a1 1 0 0 0-2 0m6 0a1 1 0 1 0 2 0a1 1 0 0 0-2 0"></path>
                        <path d="M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833-1.667 3.5-3c.667-1.667.5-5.833-1.5-11.5c-1.457-1.015-3-1.34-4.5-1.5l-.972 1.923a11.9 11.9 0 0 0-4.053 0L9 4c-1.5.16-3.043.485-4.5 1.5c-2 5.667-2.167 9.833-1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2-2 2-3"></path>
                        <path d="M7 16.5c3.5 1 6.5 1 10 0"></path>
                      </g>
                    </svg>
                  </div>
                </a>
                <a
                  href="https://x.com/beilude"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div
                    aria-label="Twitter"
                    className="footer-thq-footer-social-icon-elm2 footer-social-icon"
                  >
                    <svg
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                      height="24"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M22 4.01c-1 .49-1.98.689-3 .99c-1.121-1.265-2.783-1.335-4.38-.737S11.977 6.323 12 8v1c-3.245.083-6.135-1.395-8-4c0 0-4.182 7.433 4 11c-1.872 1.247-3.739 2.088-6 2c3.308 1.803 6.913 2.423 10.034 1.517c3.58-1.04 6.522-3.723 7.651-7.742a13.8 13.8 0 0 0 .497-3.753c0-.249 1.51-2.772 1.818-4.013z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      ></path>
                    </svg>
                  </div>
                </a>
                <a
                  href="https://github.com/baloneys"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div
                    aria-label="Instagram"
                    className="footer-thq-footer-social-icon-elm3 footer-social-icon"
                  >
                    <svg
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                      height="24"
                      viewBox="0 0 24 24"
                    >
                      <g
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5c.08-1.25-.27-2.48-1-3.5c.28-1.15.28-2.35 0-3.5c0 0-1 0-3 1.5c-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5c-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"></path>
                        <path d="M9 18c-4.51 2-5-2-7-2"></path>
                      </g>
                    </svg>
                  </div>
                </a>
              </div>
            </div>
            <div className="footer-nav-column">
              <h3 className="section-subtitle footer-column-title">
                Navigation
              </h3>
              <nav className="footer-nav-list">
                <a href="/">
                  <div className="footer-nav-link">
                    <span>Home</span>
                  </div>
                </a>
                <a
                  href="https://jinxxy.com/baloneys"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm2 footer-nav-link">
                    <span>Jinxxy Store</span>
                  </div>
                </a>
                <a
                  href="https://vrchat.com/home/user/usr_54097a4a-dab6-47ce-bcc5-00f39aa03555"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm3 footer-nav-link">
                    <span>VRChat Worlds</span>
                  </div>
                </a>
                <a
                  href="https://kanaris-beans.com/dynabackend/vrc-dynamic-player-tags.html"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm4 footer-nav-link">
                    <span>VRCDynamicPlayerTags</span>
                  </div>
                </a>
              </nav>
            </div>
            <div className="footer-nav-column">
              <h3 className="section-subtitle footer-column-title">
                Resources
              </h3>
              <nav className="footer-nav-list">
                <a
                  href="https://discord.gg/gYWJsYhwXN"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm5 footer-nav-link">
                    <span>Support Discord</span>
                  </div>
                </a>
                <a
                  href="https://kanaris-beans.com/terms"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm6 footer-nav-link">
                    <span>Terms of Service</span>
                  </div>
                </a>
                <a
                  href="https://kanaris-beans.com/privacy"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="footer-thq-footer-nav-link-elm7 footer-nav-link">
                    <span>Privacy Policy</span>
                  </div>
                </a>
                <a href="#">
                  <div className="footer-thq-footer-nav-link-elm8 footer-nav-link"></div>
                </a>
                <a href="#">
                  <div className="footer-thq-footer-nav-link-elm9 footer-nav-link"></div>
                </a>
              </nav>
            </div>
          </div>
          <div className="footer-bottom">
            <div className="footer-bottom-content">
              <p className="footer-copyright section-content">
                © 2025 baloneys. All rights reserved
              </p>
              <div className="footer-thq-footer-bottom-links-elm footer-bottom-links"></div>
            </div>
          </div>
        </div>
      </footer>
      <div className="footer-container2">
        <div className="footer-container3">
          <Script
            html={`<style>
        @keyframes footerPulse {0% {opacity: 1;
transform: scale(1);}
50% {opacity: 0.5;
transform: scale(1.2);}
100% {opacity: 1;
transform: scale(1);}}
        </style> `}
          ></Script>
        </div>
      </div>
      <div className="footer-container4">
        <div className="footer-container5">
          <Script
            html={`<script defer data-name="footer-logic">
(function(){
  const footerInputs = document.querySelectorAll(".footer-email-input")

  footerInputs.forEach((input) => {
    input.addEventListener("focus", () => {
      input.parentElement.style.boxShadow = "0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent)"
    })

    input.addEventListener("blur", () => {
      input.parentElement.style.boxShadow = "none"
    })
  })

  const newsletterForm = document.querySelector(".footer-newsletter-form")
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", (e) => {
      const input = newsletterForm.querySelector(".footer-email-input")
      if (input && input.checkValidity()) {
        const btn = newsletterForm.querySelector(".footer-submit-btn")
        const originalText = btn.innerHTML

        btn.innerHTML = "<span>Subscribed!</span>"
        btn.style.backgroundColor = "#2ecc71"
        btn.style.borderColor = "#2ecc71"
        btn.disabled = true

        setTimeout(() => {
          btn.innerHTML = originalText
          btn.style.backgroundColor = ""
          btn.style.borderColor = ""
          btn.disabled = false
          newsletterForm.reset()
        }, 3000)
      }
    })
  }
})()
</script>`}
          ></Script>
        </div>
      </div>
    </div>
  )
}

export default Footer
