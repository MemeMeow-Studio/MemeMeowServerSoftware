const config = require('../desktop.config.json')

function getProfile(channel = 'prod') {
  if (!Object.hasOwn(config.channels, channel)) throw new Error(`client_channel_invalid: ${channel}`)
  return { ...config.channels[channel], channel, serverUrl: channel === 'prod' ? config.serverUrl : config.channels[channel].serverUrl }
}

module.exports = { getProfile }
