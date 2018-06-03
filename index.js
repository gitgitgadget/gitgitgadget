const commands = require('probot-commands');

module.exports = (robot) => {
  robot.log('Yay, the app was loaded!');

  commands(robot, 'submit', async (context, command) => {
    const addComment = (comment) => {
      await context.github.issues.createComment(context.issue({ body: comment }))
    }

    if (command.arguments) {
      addComment('/submit does not take arguments')
      return;
    }

    addComment(`TODO: submit this:\n\n${JSON.stringify(context.payload, null, 4)}\n`)
  })
}
