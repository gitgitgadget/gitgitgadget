// Utility to assist in testing.  Provides a logger to use if --GGGVERBOSE is specified on the command.
// This makes it easier to leave verbose log info in the source in case it is needed.
// Normal use would be: npm test --GGGVERBOSE some.test.ts

// Using code:
// import logger from "./logger";
// logger("some  test related data");

const logger = (() => {
    const debugLog = (...body: any[]) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return console.log(...body);
    };
    const nodebugLog = () => { return; };

    return process.env.npm_config_GGGVERBOSE ? debugLog : nodebugLog;
})();

export default logger;
