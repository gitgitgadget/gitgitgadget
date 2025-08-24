async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()

  await ci.setupGitHubAction({
    needsUpstreamBranches: true,
  })
  await ci.updateOpenPrs()
  await ci.updateCommitMappings()
  await ci.handleOpenPRs()
}

run()
