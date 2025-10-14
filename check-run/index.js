async function run() {
  const { CIHelper } = await import("../dist/index.js")

  try {
    const ci = new CIHelper()
    ci.setupGitHubAction({ createOrUpdateCheckRun: true })
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
}

run()
