import React from 'react'

import Script from 'dangerous-html/react'
import { Helmet } from 'react-helmet'

import Navigation from '../components/navigation'
import VRCDynamicPlayerTags from '../components/vrc-dynamic-player-tags'
import Footer from '../components/footer'
import './home.css'

const Home = (props) => {
  return (
    <div className="home-container1">
      <Helmet>
        <title>baloneys | dumbass world creator</title>
        <meta property="og:title" content="baloneys | dumbass world creator" />
        <link
          rel="canonical"
          href="https://genuine-peaceful-elk-hohcwo.teleporthq.app/"
        />
      </Helmet>
      <Navigation></Navigation>
      <section className="hero-section">
        <div className="hero-media-container">
          <video
            src="https://videos.pexels.com/video-files/35319007/14963368_640_360_30fps.mp4"
            loop="true"
            muted="true"
            poster="https://images.pexels.com/videos/35319007/pictures/preview-0.jpg"
            autoPlay="true"
            playsInline="true"
            className="hero-bg-video"
          ></video>
          <div className="hero-overlay"></div>
        </div>
        <div className="hero-content-wrapper">
          <div className="hero-grid">
            <div className="hero-left">
              <h1 className="hero-title home-hero-title">baloneys</h1>
            </div>
            <div className="hero-right">
              <p className="hero-subtitle home-hero-subtitle">
                <span>
                  Crafting immersive experiences since the early 2020s, I want
                  to wow people with amazing experiences and provide
                  prefabricated assets of high quality.
                </span>
                <br></br>
                <span>(the real kanari does not like beans)</span>
                <br></br>
              </p>
              <div className="hero-cta-group">
                <a
                  href="https://vrchat.com/home/user/usr_54097a4a-dab6-47ce-bcc5-00f39aa03555"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="home-thq-btn-elm10 btn-primary btn-lg btn">
                    <span>Explore Worlds</span>
                  </div>
                </a>
                <a
                  href="https://jinxxy.com/baloneys"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="home-thq-btn-elm11 btn-outline btn-lg btn">
                    <span>My Jinxxy</span>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section id="store" className="store-section">
        <div className="store-container">
          <div className="store-header">
            <h2 className="section-title">Jinxxy Store</h2>
            <p className="section-subtitle">
              Premium assets and world templates for your next project.
            </p>
          </div>
          <div className="store-carousel-wrapper">
            <button
              id="store-prev"
              aria-label="Previous items"
              className="prev carousel-nav"
            >
              <svg
                width="24"
                xmlns="http://www.w3.org/2000/svg"
                height="24"
                viewBox="0 0 24 24"
              >
                <path
                  d="m12 19l-7-7l7-7m7 7H5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                ></path>
              </svg>
            </button>
            <div id="store-rail" className="store-rail">
              <div className="store-card">
                <div className="store-card-media">
                  <img
                    alt="Cyber Grid Template"
                    src="https://jinxxy-cdn.com/5d843435-8760-5cd5-aa1e-fa26cf31bfbc/3782238328112285506/917702207940398080.png"
                  />
                </div>
                <div className="store-card-content">
                  <h3 className="store-item-title">Truth or Dare</h3>
                  <p className="section-content">
                    A robust truth or dare prefab built with
                    VRCDynamicPlayerTags in mind.
                  </p>
                  <div className="store-card-footer">
                    <span className="store-price">$5.00</span>
                    <div className="store-actions">
                      <a
                        href="https://jinxxy.com/baloneys/3Gqzt"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm12 btn-sm btn-primary btn"
                      >
                        <svg
                          width="18"
                          xmlns="http://www.w3.org/2000/svg"
                          height="18"
                          viewBox="0 0 24 24"
                        >
                          <g
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle r="1" cx="8" cy="21"></circle>
                            <circle r="1" cx="19" cy="21"></circle>
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                          </g>
                        </svg>
                      </a>
                      <a
                        href="https://jinxxy.com/baloneys/3Gqzt"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm13 btn-sm btn-outline btn"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="store-card">
                <div className="store-card-media">
                  <img
                    alt="Never Have I Ever"
                    src="https://jinxxy-cdn.com/5d843435-8760-5cd5-aa1e-fa26cf31bfbc/3782221318330517170/917693818341025792.png"
                  />
                </div>
                <div className="store-card-content">
                  <h3 className="store-item-title">Never Have I Ever</h3>
                  <p className="section-content">
                    A robust Never Have I Ever prefab built with
                    VRCDynamicPlayerTags in mind.
                  </p>
                  <div className="store-card-footer">
                    <span className="store-price">$5.00</span>
                    <div className="store-actions">
                      <a
                        href="https://jinxxy.com/baloneys/CVrpj"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm14 btn-sm btn-primary btn"
                      >
                        <svg
                          width="18"
                          xmlns="http://www.w3.org/2000/svg"
                          height="18"
                          viewBox="0 0 24 24"
                        >
                          <g
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle r="1" cx="8" cy="21"></circle>
                            <circle r="1" cx="19" cy="21"></circle>
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                          </g>
                        </svg>
                      </a>
                      <a
                        href="https://jinxxy.com/baloneys/CVrpj"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm15 btn-sm btn-outline btn"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="store-card">
                <div className="store-card-media">
                  <img
                    alt="Warmth in Seclusion"
                    src="https://jinxxy-cdn.com/5d843435-8760-5cd5-aa1e-fa26cf31bfbc/3773395678961599866/913281089990691840.png"
                  />
                </div>
                <div className="store-card-content">
                  <h3 className="store-item-title">Warmth in Seclusion</h3>
                  <p className="section-content">
                    A cozy, prefabricated world that features ambient rain,
                    thunder, and boasts both day and night scenes.
                  </p>
                  <div className="store-card-footer">
                    <span className="store-price">$25.00</span>
                    <div className="store-actions">
                      <a
                        href="https://jinxxy.com/baloneys/VKR6R"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm16 btn-sm btn-primary btn"
                      >
                        <svg
                          width="18"
                          xmlns="http://www.w3.org/2000/svg"
                          height="18"
                          viewBox="0 0 24 24"
                        >
                          <g
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle r="1" cx="8" cy="21"></circle>
                            <circle r="1" cx="19" cy="21"></circle>
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                          </g>
                        </svg>
                      </a>
                      <a
                        href="https://jinxxy.com/baloneys/VKR6R"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm17 btn-sm btn-outline btn"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="store-card">
                <div className="store-card-media">
                  <img
                    alt="Fine Marker SKin"
                    src="https://jinxxy-cdn.com/5d843435-8760-5cd5-aa1e-fa26cf31bfbc/3778289993408054836/915728247727770624.png"
                  />
                </div>
                <div className="store-card-content">
                  <h3 className="store-item-title">
                    Fine Art Marker skin for QVPen
                  </h3>
                  <p className="section-content">
                    A fine-art marker pen skin designed for QVPen
                  </p>
                  <div className="store-card-footer">
                    <span className="store-price">$1.00</span>
                    <div className="store-actions">
                      <a
                        href="https://jinxxy.com/baloneys/Eoml7"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm18 btn-sm btn-primary btn"
                      >
                        <svg
                          width="18"
                          xmlns="http://www.w3.org/2000/svg"
                          height="18"
                          viewBox="0 0 24 24"
                        >
                          <g
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle r="1" cx="8" cy="21"></circle>
                            <circle r="1" cx="19" cy="21"></circle>
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                          </g>
                        </svg>
                      </a>
                      <a
                        href="https://jinxxy.com/baloneys/Eoml7"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm19 btn-sm btn-outline btn"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="store-card">
                <div className="store-card-media">
                  <img
                    alt="Goon of Fortune"
                    src="https://jinxxy-cdn.com/5d843435-8760-5cd5-aa1e-fa26cf31bfbc/3774823090857444598/913994603585940480.png"
                  />
                </div>
                <div className="store-card-content">
                  <h3 className="store-item-title">Goon of Fortune</h3>
                  <p className="section-content">
                    A variant of the classic Australian drinking game, that
                    tracks and selects players automatically within a radius
                  </p>
                  <div className="store-card-footer">
                    <span className="store-price">$5.00</span>
                    <div className="store-actions">
                      <a
                        href="https://jinxxy.com/baloneys/QuzhZ"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm20 btn-sm btn-primary btn"
                      >
                        <svg
                          width="18"
                          xmlns="http://www.w3.org/2000/svg"
                          height="18"
                          viewBox="0 0 24 24"
                        >
                          <g
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle r="1" cx="8" cy="21"></circle>
                            <circle r="1" cx="19" cy="21"></circle>
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                          </g>
                        </svg>
                      </a>
                      <a
                        href="https://jinxxy.com/baloneys/QuzhZ"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="home-thq-btn-elm21 btn-sm btn-outline btn"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button
              id="store-next"
              aria-label="Next items"
              className="carousel-nav next"
            >
              <svg
                width="24"
                xmlns="http://www.w3.org/2000/svg"
                height="24"
                viewBox="0 0 24 24"
              >
                <path
                  d="M5 12h14m-7-7l7 7l-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                ></path>
              </svg>
            </button>
          </div>
        </div>
      </section>
      <VRCDynamicPlayerTags rootClassName="vrc-dynamic-player-tagsroot-class-name"></VRCDynamicPlayerTags>
      <section className="showcase-section">
        <div className="showcase-grid-container">
          <div className="showcase-item">
            <img
              alt="Cyberpunk Cityscape"
              src="https://api.vrchat.cloud/api/1/file/file_579ece5a-4e10-4c40-94ee-f747bcbd534e/4/file"
            />
            <div className="home-thq-showcase-overlay-elm1 showcase-overlay">
              <h3 className="section-subtitle">Moonlight Daydream</h3>
              <p className="section-content">
                Explore the rain-slicked streets of a neo-tokyo inspired
                landscape.
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_9c83c33c-5c95-4d0c-b7c1-2579081a6e4b/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm1 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
          <div className="showcase-item">
            <img
              alt="Digital Sanctuary"
              src="https://api.vrchat.cloud/api/1/file/file_3091011f-cc9c-4946-9e0d-839d1ad06207/1/file"
            />
            <div className="showcase-overlay">
              <h3 className="section-subtitle">Secluded Warmth</h3>
              <p className="section-content">
                An ambient, cozy environment complete with rain and thunder for
                an ambient sleeping experience
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_5ee3a047-669c-4f63-9d0a-9e10a75c0544/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm2 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
          <div className="showcase-item">
            <img
              alt="Tech Lab"
              src="https://api.vrchat.cloud/api/1/file/file_3090a813-7426-46e9-a3d3-6c5705272d46/2/file"
            />
            <div className="showcase-overlay">
              <h3 className="section-subtitle">
                Minecraft: Snowy Forest Cottage
              </h3>
              <p className="section-content">
                A cozy, ambient world that attempts to replicate the coziness of
                a shaded cabin in the Minecraft woods.
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_8d947e6e-8476-4022-be7e-5998246166c6/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm3 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
          <div className="showcase-item">
            <img
              alt="Question Space"
              src="https://api.vrchat.cloud/api/1/file/file_41e7debb-faaa-4957-9af4-af285ef8ca87/3/file"
            />
            <div className="showcase-overlay">
              <h3 className="section-subtitle">Question Space</h3>
              <p className="section-content">
                A world showcasing the technology of VRCDynamicPlayerTags
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_26b28133-fc03-4cd1-b2c8-a18854c1f075/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm4 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
          <div className="showcase-item">
            <img
              alt="The Lilypad"
              src="https://api.vrchat.cloud/api/1/file/file_10e6c887-dc07-49b1-90ae-af7c45f21f22/1/file"
            />
            <div className="showcase-overlay">
              <h3 className="section-subtitle">The Lilypad</h3>
              <p className="section-content">
                Created for the creekside crew, this world is my premiere
                Australian-based drinking project.
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_3d2a3ee8-85ec-4b6b-a206-6d028a77d8af/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm5 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
          <div className="showcase-item">
            <img
              alt="Drinking Party"
              src="https://api.vrchat.cloud/api/1/file/file_320e9c95-fd26-44c2-94fe-b06529167f9c/3/file"
            />
            <div className="showcase-overlay">
              <h3 className="section-subtitle">Drinking Party</h3>
              <p className="section-content">
                Created by Bazlowww, this world proudly showcases
                VRCDynamicPlayerTags technology. I have also helped a tiny bit
                with the development of this world.
              </p>
              <a
                href="https://vrchat.com/home/world/wrld_324b9e6e-759a-4c9b-8770-1a15b7ab3021/info"
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="home-thq-showcase-link-elm6 showcase-link">
                  <span>
                    {' '}
                    Launch World
                    <span
                      dangerouslySetInnerHTML={{
                        __html: ' ',
                      }}
                    />
                  </span>
                  <svg
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                    height="18"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    ></path>
                  </svg>
                </div>
              </a>
            </div>
          </div>
        </div>
      </section>
      <section id="commission" className="cta-section">
        <div className="cta-container">
          <div className="cta-split">
            <div className="cta-content">
              <h2 className="section-title">Need Support?</h2>
              <p className="section-content">
                Join my community discord server for further support regarding
                my prefabs or to query potential work.
              </p>
              <div className="cta-btns">
                <a
                  href="https://discord.gg/gYWJsYhwXN"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="home-thq-btn-elm22 btn-accent btn-xl btn">
                    <span>Join the community!</span>
                  </div>
                </a>
              </div>
            </div>
            <div className="cta-visual">
              <img
                alt="Futuristic VR Experience"
                src="https://kanaris-beans.com/VRChat_2025-11-15_00-50-30.956_1920x1080.png"
              />
            </div>
          </div>
        </div>
      </section>
      <div className="home-container2">
        <div className="home-container3">
          <Script
            html={`<style>
        @keyframes fadeIn {from {opacity: 0;
transform: translateY(10px);}
to {opacity: 1;
transform: translateY(0);}}
        </style> `}
          ></Script>
        </div>
      </div>
      <div className="home-container4">
        <div className="home-container5">
          <Script
            html={`<script defer data-name="baloneys-interactions">
(function(){
  // Store Carousel Navigation
  const rail = document.getElementById("store-rail")
  const prevBtn = document.getElementById("store-prev")
  const nextBtn = document.getElementById("store-next")

  if (rail && prevBtn && nextBtn) {
    nextBtn.addEventListener("click", () => {
      const cardWidth = rail.querySelector(".store-card").offsetWidth + 24
      rail.scrollBy({ left: cardWidth, behavior: "smooth" })
    })

    prevBtn.addEventListener("click", () => {
      const cardWidth = rail.querySelector(".store-card").offsetWidth + 24
      rail.scrollBy({ left: -cardWidth, behavior: "smooth" })
    })
  }

  // Testimonials Carousel
  const testimonials = document.querySelectorAll(".testimonial-item")
  const dots = document.querySelectorAll(".dot")
  let currentTestimonial = 0

  function showTestimonial(index) {
    testimonials.forEach((t) => t.classList.remove("active"))
    dots.forEach((d) => d.classList.remove("active"))

    testimonials[index].classList.add("active")
    dots[index].classList.add("active")
  }

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      currentTestimonial = index
      showTestimonial(currentTestimonial)
    })
  })

  // Auto-rotate testimonials
  setInterval(() => {
    currentTestimonial = (currentTestimonial + 1) % testimonials.length
    showTestimonial(currentTestimonial)
  }, 5000)

  // Parallax for Hero Video
  window.addEventListener("scroll", () => {
    const scroll = window.pageYOffset
    const video = document.querySelector(".hero-bg-video")
    if (video) {
      video.style.transform = \`translateY(\${scroll * 0.3}px)\`
    }
  })
})()
</script>`}
          ></Script>
        </div>
      </div>
      <Footer></Footer>
      <a href="https://play.teleporthq.io/signup">
        <div aria-label="Sign up to TeleportHQ" className="home-container6">
          <svg
            width="24"
            height="24"
            viewBox="0 0 19 21"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="home-icon51"
          >
            <path
              d="M9.1017 4.64355H2.17867C0.711684 4.64355 -0.477539 5.79975 -0.477539 7.22599V13.9567C-0.477539 15.3829 0.711684 16.5391 2.17867 16.5391H9.1017C10.5687 16.5391 11.7579 15.3829 11.7579 13.9567V7.22599C11.7579 5.79975 10.5687 4.64355 9.1017 4.64355Z"
              fill="#B23ADE"
            ></path>
            <path
              d="M10.9733 12.7878C14.4208 12.7878 17.2156 10.0706 17.2156 6.71886C17.2156 3.3671 14.4208 0.649963 10.9733 0.649963C7.52573 0.649963 4.73096 3.3671 4.73096 6.71886C4.73096 10.0706 7.52573 12.7878 10.9733 12.7878Z"
              fill="#FF5C5C"
            ></path>
            <path
              d="M17.7373 13.3654C19.1497 14.1588 19.1497 15.4634 17.7373 16.2493L10.0865 20.5387C8.67402 21.332 7.51855 20.6836 7.51855 19.0968V10.5141C7.51855 8.92916 8.67402 8.2807 10.0865 9.07221L17.7373 13.3654Z"
              fill="#2874DE"
            ></path>
          </svg>
          <span className="home-text23">Built in TeleportHQ</span>
        </div>
      </a>
    </div>
  )
}

export default Home
