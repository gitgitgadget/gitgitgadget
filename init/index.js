async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()
  await ci.setupGitHubAction()
}

run()
