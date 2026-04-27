import chalk from "chalk";

const bannerText = `
   _____           ____        __
  / ___/__  _____/ __ \\__  __/ /_______
  \\__ \\/ / / / _  /_/ / / / / / ___/ _ \\
 ___/ / /_/ /  __/ ____/ /_/ / (__  )  __/
/____/\\__, /\\___/_/    \\__,_/_/____/\\___/
     /____/
`;

export const logger = {
  banner() {
    console.log(chalk.cyanBright(bannerText));
  },
  step(message: string) {
    console.log(chalk.cyan(`> ${message}`));
  },
  info(message: string) {
    console.log(chalk.white(message));
  },
  success(message: string) {
    console.log(chalk.green(`[ok] ${message}`));
  },
  warn(message: string) {
    console.warn(chalk.yellow(`[warn] ${message}`));
  },
  error(message: string) {
    console.error(chalk.red(`[error] ${message}`));
  }
};
