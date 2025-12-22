import React from 'react'

import PropTypes from 'prop-types'

import './vrc-dynamic-player-tags.css'

const VRCDynamicPlayerTags = (props) => {
  return (
    <div
      className={`vrc-dynamic-player-tags-container ${props.rootClassName} `}
    >
      <div className="vrc-dynamic-player-tags-thq-vrc-dpt-background-elm vrc-dpt-background"></div>
      <div className="vrc-dynamic-player-tags-thq-vrc-dpt-content-elm">
        <div className="vrc-dynamic-player-tags-thq-vrc-dpt-text-content-elm">
          <h2 className="vrc-dynamic-player-tags-thq-vrc-dpt-title-elm">
            VRCDynamicPlayerTags
          </h2>
          <p className="vrc-dynamic-player-tags-thq-vrc-dpt-description-elm">
            A robust, prefab agnostic Dynamic Player Tagging system that
            supports player zone tracking, with an easy-to-use interface for
            immense compatibility.
          </p>
        </div>
        <div className="vrc-dpt-buttons">
          <a
            href="https://jinxxy.com/baloneys"
            target="_blank"
            rel="noreferrer noopener"
            className="vrc-dynamic-player-tags-thq-btn-elm1 button btn-primary btn"
          >
            Buy on Jinxxy
          </a>
          <a
            href="https://kanaris-beans.com/dynabackend/vrc-dynamic-player-tags.html"
            target="_blank"
            rel="noreferrer noopener"
            className="vrc-dynamic-player-tags-thq-btn-elm2 btn-outline button btn"
          >
            View Database
          </a>
        </div>
      </div>
    </div>
  )
}

VRCDynamicPlayerTags.defaultProps = {
  rootClassName: '',
}

VRCDynamicPlayerTags.propTypes = {
  rootClassName: PropTypes.string,
}

export default VRCDynamicPlayerTags
