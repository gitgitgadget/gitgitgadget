async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()
  const { owner, prNumber } = ci.parsePRURLInput()

  await ci.setupGitHubAction()
  await ci.handlePush(owner, prNumber)
}

run()
