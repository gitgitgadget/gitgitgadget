async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()
  const { owner, pull_number } = ci.parsePRURLInput()

  await ci.setupGitHubAction()
  await ci.handlePush(owner, pull_number)
}

run()
