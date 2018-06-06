const {findPrivateKey} = require('probot/lib/private-key')
const createProbot = require('probot')
const probot = createProbot({
  id: process.env.APP_ID,
  secret: process.env.WEBHOOK_SECRET,
  cert: findPrivateKey(),
  port: process.env.PORT,
  webhookPath: process.env.WEBHOOK_PATH,
  webhookProxy: process.env.WEBHOOK_PROXY_URL
})
probot.setup(["./index.js"]);
probot.start()
